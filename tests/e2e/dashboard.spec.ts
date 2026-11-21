import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { createCanvas, loadImage } from "@napi-rs/canvas";

import { clerk } from "@clerk/testing/playwright";
import type { KinetixRigState } from "../../lib/rig/model";
import { forwardKinematics } from "../../lib/rig/kinematics";
import { worldPartBounds } from "../../lib/rig/path-layout";
import { formats, type ExportFormat } from "../../lib/export/frames";

test.beforeEach(async ({page}) => {
  await page.goto("/");
  await clerk.signIn({page, emailAddress:process.env.KINETIX_TEST_EMAIL!});
});

async function expectStudioViewport(page:Page) {
  await expect.poll(()=>page.evaluate(()=>{
    const root=document.documentElement;
    const studio=document.querySelector(".studio-shell");
    return {horizontalOverflow:Math.max(0,root.scrollWidth-innerWidth),verticalOverflow:Math.max(0,root.scrollHeight-innerHeight),
      viewportHeightMatches:Boolean(studio && Math.abs(studio.getBoundingClientRect().height-innerHeight)<1)};
  })).toEqual({horizontalOverflow:0,verticalOverflow:0,viewportHeightMatches:true});
}

test("an illustrator paints, links, recolors, and exports pixel cels",async ({page},info)=>{
  test.setTimeout(100_000);
  const create = await page.request.post("/api/rigs",{data:{
    name:"Drawn flame "+info.project.name,artboard:{name:"Flame",width:96,height:96,background:null},
  }});
  expect(create.status()).toBe(201);
  const {id}=await create.json();
  const path="/api/rigs/"+id;
  try {
    const clip = await page.request.post(path+"/clips",{data:{name:"Flicker",fps:12,frameCount:12}});
    expect(clip.status()).toBe(201);
    const {id:clipId}=await clip.json();
    await page.goto("/studio/"+id);
    const layers=page.getByRole("region",{name:"Artwork layers"});
    await layers.getByText("Add drawing layer",{exact:true}).click();
    await layers.getByRole("button",{name:"Indexed drawing",exact:true}).click();
    await expect(layers.getByRole("button",{name:"Drawing 1",exact:true})).toHaveAttribute("aria-pressed","true");
    const panel=page.getByLabel("Drawing tools",{exact:true});
    const canvas=page.getByRole("img",{name:"Rig canvas"});
    const bounds=(await canvas.boundingBox())!;
    const scale=Math.min(bounds.width,bounds.height)/96;
    const point=(x:number,y:number)=>({x:bounds.x+bounds.width/2+(x+.5-48)*scale,y:bounds.y+bounds.height/2+(y+.5-48)*scale});
    const mark=async (x:number,y:number)=>{ const p=point(x,y);await page.mouse.click(p.x,p.y); };
    const slider=page.getByRole("slider",{name:"Timeline frame"});
    const seek=async (frame:number)=>{ await slider.fill(String(frame));await expect(panel.getByText("Frame "+(frame+1),{exact:true})).toBeVisible(); };
    await mark(45,48);
    await mark(46,47);
    await seek(2);
    await panel.getByRole("button",{name:"Link held cel"}).click();
    await seek(5);
    await panel.getByRole("button",{name:"Make independent"}).click();
    await mark(49,48);
    await seek(8);
    await panel.getByRole("button",{name:"Blank exposure"}).click();
    await expect(page.getByRole("button",{name:"Drawing 1 blank exposure 9"})).toBeVisible();
    await page.getByRole("button",{name:"Previous cel exposure"}).click();
    await expect(panel.getByText("Frame 6",{exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Next cel exposure"}).click();
    await expect(panel.getByText("Frame 9",{exact:true})).toBeVisible();
    await panel.getByLabel("Edit palette color").fill("#7249ff");
    const saved=async()=>{
      const response=await page.request.get(path+"/state");
      if (response.status()===429 || response.status()===503) return;
      expect(response.ok(),`Read saved drawing returned HTTP ${response.status()}`).toBe(true);
      return ((await response.json()).state as KinetixRigState).drawings?.layers[0];
    };
    const readback:{drawing?:Awaited<ReturnType<typeof saved>>}={};
    await expect.poll(async()=>(readback.drawing=await saved())?.storage,{intervals:[300,650,1100]})
      .toMatchObject({mode:"indexed",colors:["#7249ff","#fff2a0","#d54139","#202a48"]});
    const drawing=readback.drawing;
    if (!drawing) throw new Error("The saved drawing could not be loaded.");
    expect(drawing.tracks[0]).toMatchObject({clipId,keys:[
      {frame:0,celId:drawing.cels[0].id},{frame:2,celId:drawing.cels[0].id},
      {frame:5,celId:drawing.cels[1].id},{frame:8,celId:null},
    ]});
    expect(drawing.cels[0].runs).toHaveLength(2);
    expect(drawing.cels[1].runs).toHaveLength(3);
    await page.getByRole("button",{name:"Export",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"Export animation"});
    await dialog.getByLabel("Format").selectOption("sprite-package");
    for (const scale of [1,3]) {
      await dialog.getByLabel("Pixel scale").selectOption(String(scale));
      const download=page.waitForEvent("download");
      await dialog.getByRole("button",{name:"Download sprite package"}).click();
      const files=unzipSync(await readFile(await (await download).path()));
      const manifest=JSON.parse(strFromU8(files["kinetix.json"]));
      const atlas=await loadImage(files["atlas.png"]);
      const context=createCanvas(atlas.width,atlas.height).getContext("2d");
      context.drawImage(atlas,0,0);
      expect(manifest.frames.map((frame:{durationTicks:number})=>frame.durationTicks)).toEqual(Array(12).fill(1));
      const read=(frame:number,x:number,y:number)=>{
        const rectangle=manifest.frames[frame].rect;
        expect([rectangle.width,rectangle.height]).toEqual([96*scale,96*scale]);
        return Array.from(context.getImageData(rectangle.x+x*scale,rectangle.y+y*scale,scale,scale).data);
      };
      const purple=Array.from({length:scale*scale},()=>[114,73,255,255]).flat();
      const transparent=Array(scale*scale*4).fill(0);
      expect(read(4,45,48)).toEqual(purple);
      expect(read(4,49,48)).toEqual(transparent);
      expect(read(6,49,48)).toEqual(purple);
      expect(read(6,48,48)).toEqual(transparent);
      expect(read(8,45,48)).toEqual(transparent);
    }
  } finally {
    expect((await page.request.delete(path)).status()).toBe(204);
  }
});

test("an illustrator groups, hides, locks, isolates, and duplicates artwork layers",async ({page},info)=>{
  const create = await page.request.post("/api/rigs",{data:{
    name:"Layered badge "+info.project.name,artboard:{name:"Badge",width:200,height:180,background:null},
  }});
  expect(create.status()).toBe(201);
  const {id,revision,state} = await create.json();
  const path = "/api/rigs/"+id;
  try {
    const rectangle = (id:string,name:string,fill:string,low:number,high:number) => ({
      id,name,parentId:null,offset:{x:0,y:0},fill,closed:true,
      knots:[{point:{x:low,y:low}},{point:{x:high,y:low}},{point:{x:high,y:high}},{point:{x:low,y:high}}],
    });
    expect((await page.request.patch(path+"/state",{data:{revision,state:{...state,parts:[
      rectangle("badge","Badge","#ff0000",40,130),rectangle("shine","Shine","#0022ff",75,110),
    ]}}})).status()).toBe(200);
    await page.goto("/studio/"+id);
    const layers = page.getByRole("region",{name:"Artwork layers"});
    const nameButton = (name:string) => layers.getByRole("button",{name,exact:true});
    const row = (name:string) => nameButton(name).locator("xpath=..");
    await nameButton("Badge").click();
    await nameButton("Group selected").click();
    await layers.getByLabel("Group name").fill("Logo");
    await layers.getByLabel("Group name").press("Enter");
    await nameButton("Shine").click();
    await layers.getByLabel("Parent group").selectOption({label:"Logo"});
    await row("Logo").getByRole("button",{name:"Hide layer"}).click({timeout:8000});
    const saved = async () => (await (await page.request.get(path+"/state")).json()).state as KinetixRigState;
    await expect.poll(async()=>(await saved()).layers?.nodes.find(node=>node.kind==="group")?.hidden).toBe(true);
    const hiddenAlpha = await page.evaluate(async route=>{
      const image = await createImageBitmap(await (await fetch(route)).blob());
      const ctx = new OffscreenCanvas(image.width,image.height).getContext("2d")!;
      ctx.drawImage(image,0,0);
      return ctx.getImageData(90,90,1,1).data[3];
    },path+"/artboard.png");
    expect(hiddenAlpha).toBe(0);
    await row("Logo").getByRole("button",{name:"Show layer"}).click();
    await row("Logo").getByRole("button",{name:"Lock layer"}).click();
    await nameButton("Shine").click();
    await expect(page.getByText("Show and unlock the layer to edit it on the canvas.")).toBeVisible();
    await row("Logo").getByRole("button",{name:"Unlock layer"}).click();
    await nameButton("Isolate layer").click();
    await expect(nameButton("Exit isolation")).toBeVisible();
    await nameButton("Exit isolation").click();
    await nameButton("Logo").click();
    await nameButton("Duplicate layer").click();
    await expect(nameButton("Logo copy")).toBeVisible();
    await layers.getByRole("searchbox",{name:"Search layers"}).fill("Shine");
    await expect(nameButton("Shine")).toBeVisible();
    await expect(nameButton("Shine copy")).toBeVisible();
    await expect(nameButton("Badge")).toHaveCount(0);
  } finally {
    expect((await page.request.delete(path)).status()).toBe(204);
  }
});

test("an illustrator delivers a badge with a cutout, clipped gradient, and linked fills",async ({page},info)=>{
  const create = await page.request.post("/api/rigs",{data:{
    name:"Badge appearance "+info.project.name,artboard:{name:"Badge",width:300,height:240,background:null},
  }});
  expect(create.status()).toBe(201);
  const {id,revision,state} = await create.json();
  const path = "/api/rigs/"+id;
  try {
    const box = (id:string,name:string,left:number,top:number,right:number,bottom:number) => ({
      id,name,parentId:null,offset:{x:0,y:0},fill:"#008844",closed:true,
      knots:[{point:{x:left,y:top}},{point:{x:right,y:top}},{point:{x:right,y:bottom}},{point:{x:left,y:bottom}}],
    });
    const parts = [
      box("badge","Badge",95,76,205,152),box("hole","Cutout",126,103,173,138),
      box("shine","Highlight",60,69,246,94),box("tag","Tag",130,174,170,194),
    ];
    expect((await page.request.patch(path+"/state",{data:{revision,state:{...state,parts}}})).status()).toBe(200);
    await page.goto("/studio/"+id);
    const layers = page.getByRole("region",{name:"Artwork layers"});
    const layer = (name:string) => layers.getByRole("button",{name,exact:true});
    const highlight = layer("Highlight").locator("xpath=..");
    await highlight.getByRole("button",{name:"Hide layer"}).click();
    await page.getByRole("button",{name:"Region select",exact:true}).click();
    const canvas = (await page.getByRole("img",{name:"Rig canvas"}).boundingBox())!;
    const scale = Math.min(canvas.width/300,canvas.height/240);
    const x = (world:number)=>canvas.x+canvas.width/2+(world-150)*scale;
    const y = (world:number)=>canvas.y+canvas.height/2+(world-120)*scale;
    await page.mouse.move(x(88),y(70));
    await page.mouse.down();
    await page.mouse.move(x(212),y(159),{steps:6});
    await page.mouse.up();
    const inspector = page.getByRole("complementary",{name:"Inspector"});
    await expect(inspector.getByText("2 paths selected")).toBeVisible();
    await inspector.getByText("Combine paths",{exact:true}).click();
    await inspector.getByLabel("Base path").selectOption("badge");
    await inspector.getByRole("button",{name:"Subtract",exact:true}).click();
    await expect(layer("Cutout")).toHaveCount(0);

    const appearance = inspector.locator("details").filter({has:page.getByText("Appearance",{exact:true})});
    const openAppearance = async () => {
      if (await appearance.getAttribute("open")===null) await appearance.locator("summary").click();
    };
    await openAppearance();
    await appearance.getByRole("button",{name:"Manage swatches"}).click();
    const swatches = page.getByRole("dialog",{name:"Swatches"});
    await swatches.getByRole("button",{name:"Save current paint as swatch"}).click();
    await swatches.getByLabel("Swatch name",{exact:true}).fill("Brand");
    await swatches.getByLabel("Swatch name",{exact:true}).press("Enter");
    await swatches.getByRole("button",{name:"Close dialog"}).click();
    await appearance.getByLabel("Fill type").selectOption("swatch");
    await layer("Tag").click();
    await openAppearance();
    await appearance.getByLabel("Fill type").selectOption("swatch");
    await highlight.getByRole("button",{name:"Show layer"}).click();
    await layer("Highlight").click();
    await layers.getByLabel("Clipping mask").selectOption("badge");
    await openAppearance();
    await appearance.getByLabel("Fill type").selectOption("linear");
    await appearance.getByLabel("Fill stop 1",{exact:true}).fill("#000000");

    await layer("Badge").click();
    await openAppearance();
    await appearance.getByRole("button",{name:"Manage swatches"}).click();
    await swatches.getByLabel("Swatch color",{exact:true}).fill("#6600cc");
    await swatches.getByRole("button",{name:"Close dialog"}).click();

    const savedPaint=async()=>{
      const response=await page.request.get(path+"/state");
      if (!response.ok()) return {status:response.status()};
      const {state}=await response.json() as {state:KinetixRigState};
      return state.swatches?.[0]?.paint;
    };
    await expect.poll(savedPaint,{intervals:[300,650,1100]}).toEqual({kind:"solid",color:"#6600cc"});
    const pixels = () => page.evaluate(async route=>{
      const response = await fetch(route,{cache:"no-store"});
      if (!response.ok) throw new Error("Artwork export returned "+response.status);
      const image = await createImageBitmap(await response.blob());
      const context = new OffscreenCanvas(image.width,image.height).getContext("2d")!;
      context.drawImage(image,0,0);
      return [[106,124],[150,180],[150,118],[85,84],[108,84],[189,84]].map(([x,y])=>
        Array.from(context.getImageData(x,y,1,1).data));
    },path+"/artboard.png");
    const changed = await pixels();
    expect(changed.slice(0,4)).toEqual([[102,0,204,255],[102,0,204,255],[0,0,0,0],[0,0,0,0]]);
    expect(changed[4][3]).toBe(255);
    expect(changed[4][0]).toBeLessThan(changed[5][0]);
    await page.getByRole("button",{name:"Undo",exact:true}).click();
    await expect.poll(savedPaint,{intervals:[300,650,1100]}).toEqual({kind:"solid",color:"#008844"});
    expect((await pixels()).slice(0,2)).toEqual([[0,136,68,255],[0,136,68,255]]);
    await page.reload();
    await expect(layer("Badge")).toBeVisible();
    expect((await pixels())[2][3]).toBe(0);
  } finally {
    expect((await page.request.delete(path)).status()).toBe(204);
  }
});

test("an illustrator edits a three-color junction and subdivides its deformation mesh",async ({page},info)=>{
  const response = await page.request.post("/api/rigs",{data:{
    name:"Faceted artwork "+info.project.name,artboard:{name:"Facets",width:300,height:240,background:null},
  }});
  expect(response.status()).toBe(201);
  const {id,revision,state} = await response.json();
  const path = "/api/rigs/"+id;
  try {
    const part = {id:"surface",name:"Surface",parentId:null,offset:{x:0,y:0},closed:true,fill:"#ff0000",
      knots:[{point:{x:90,y:70}},{point:{x:210,y:70}},{point:{x:210,y:190}},{point:{x:90,y:190}}]};
    const bones = [{id:"joint",name:"Joint",parentId:null,length:22,offset:{x:30,y:30},rotation:0}];
    expect((await page.request.patch(path+"/state",{data:{revision,state:{...state,bones,parts:[part]}}})).status()).toBe(200);
    await page.goto("/studio/"+id);
    await page.getByRole("button",{name:"Surface",exact:true}).click();
    await page.getByRole("button",{name:"Make faceted artwork"}).click();
    const tools = page.getByRole("region",{name:"Facet tools"});
    const vertexA = tools.getByRole("combobox",{name:"Vertex 1",exact:true});
    const vertexB = tools.getByRole("combobox",{name:"Vertex 2",exact:true});
    const face = tools.getByRole("combobox",{name:"Active face"});
    await vertexA.selectOption("vertex-1");
    await vertexB.selectOption("vertex-3");
    await tools.getByRole("button",{name:"Cut face",exact:true}).click();
    await expect(face.locator("option")).toHaveCount(2);
    await vertexA.selectOption("vertex-1");
    await vertexB.selectOption("vertex-3");
    await tools.getByRole("button",{name:"Split shared edge"}).click();
    await vertexA.selectOption({label:"Vertex 5"});
    const middle = await vertexA.inputValue();
    await vertexB.selectOption("vertex-2");
    await tools.getByRole("button",{name:"Cut face",exact:true}).click();
    await expect(face.locator("option")).toHaveCount(3);
    for (const [index,color] of [[0,"#ff0000"],[1,"#00b400"],[2,"#0022ff"]] as const) {
      await face.selectOption({index});
      await tools.getByLabel("Face color",{exact:true}).fill(color);
    }
    const canvas = page.getByRole("img",{name:"Rig canvas"});
    const bounds = (await canvas.boundingBox())!;
    const scale = Math.min(bounds.width/300,bounds.height/240);
    const x = (world:number)=>bounds.x+bounds.width/2+(world-150)*scale;
    const y = (world:number)=>bounds.y+bounds.height/2+(world-120)*scale;
    await tools.getByRole("button",{name:"Vertex",exact:true}).click();
    await page.mouse.move(x(150),y(130));
    await page.mouse.down();
    await page.mouse.move(x(135),y(145),{steps:6});
    await page.mouse.up();
    await expect(vertexA).toHaveValue(middle);
    await expect.poll(async()=>Math.round(Number(await tools.getByLabel("Vertex X (px)").inputValue()))).toBe(135);
    await tools.getByRole("button",{name:"Eyedropper"}).click();
    await page.mouse.click(x(106),y(166));
    await expect(tools.getByLabel("Drawing color",{exact:true})).toHaveValue("#0022ff");
    await page.getByRole("button",{name:"Bind mesh",exact:true}).click();
    const box = page.getByLabel("Deformation triangle",{exact:true});
    const triangleCount = Number(await box.getAttribute("max"));
    await page.getByRole("button",{name:"Split deformation triangle"}).click();
    await expect(box).toHaveAttribute("max",String(triangleCount+2));
    const getState = async () => (await (await page.request.get(path+"/state")).json()).state as KinetixRigState;
    await expect.poll(async()=>(await getState()).parts[0]?.mesh?.triangles.length).toBe(triangleCount+2);
    const result = (await getState()).parts[0];
    expect(result.facets?.faces.map(item=>item.fill)).toEqual(["#ff0000","#00b400","#0022ff"]);
    expect(result.facets?.faces.every(item=>item.vertices.includes(middle))).toBe(true);
    expect(result.mesh?.vertices.at(-1)?.splitFrom).toHaveLength(3);
    const samples = await page.evaluate(async route=>{
      const blob = await (await fetch(route)).blob();
      const image = await createImageBitmap(blob);
      const exported = new OffscreenCanvas(image.width,image.height);
      const ctx = exported.getContext("2d")!;
      ctx.drawImage(image,0,0);
      return [[188,126],[145,95],[106,166]].map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data));
    },path+"/artboard.png");
    expect(samples).toEqual([[255,0,0,255],[0,180,0,255],[0,34,255,255]]);
    await face.selectOption({index:2});
    await tools.getByRole("button",{name:"Preview triangulation"}).click();
    await expect(face.locator("option")).toHaveCount(3);
    await tools.getByRole("button",{name:"Apply triangles"}).click();
    await expect(face.locator("option")).toHaveCount(4);
    await page.getByRole("button",{name:"Undo",exact:true}).click();
    await expect(face.locator("option")).toHaveCount(3);
  } finally {
    expect((await page.request.delete(path)).status()).toBe(204);
  }
});

test("an illustrator lays out shapes with region selection, rulers, and guide snapping", async ({page},info) => {
  const create = await page.request.post("/api/rigs",{data:{
    name:"Precision layout " + info.project.name,artboard:{name:"Marks",width:300,height:240,background:null},
  }});
  expect(create.status()).toBe(201);
  const {id} = await create.json();
  const path = "/api/rigs/"+id;
  try {
    await page.goto("/studio/"+id);
    const canvas = page.getByRole("img",{name:"Rig canvas"});
    await expect(canvas).toBeVisible();
    const bounds = (await canvas.boundingBox())!;
    const factor = Math.min(bounds.width/300,bounds.height/240);
    const x = (pixel:number) => bounds.x+bounds.width/2+(pixel-150)*factor;
    const y = (pixel:number) => bounds.y+bounds.height/2+(pixel-120)*factor;
    async function drag(x1:number,y1:number,x2:number,y2:number) {
      await page.mouse.move(x(x1),y(y1));
      await page.mouse.down();
      await page.mouse.move(x(x2),y(y2),{steps:5});
      await page.mouse.up();
    }
    for (const [shape, x1,y1,x2,y2] of [
      ["rectangle",85,74,119,107],["ellipse",138,93,176,129],["star",186,115,223,152],
    ] as const) {
      await page.getByRole("button",{name:"Shapes",exact:true}).click();
      await page.getByRole("combobox",{name:"Shape",exact:true}).selectOption(shape);
      await drag(x1,y1,x2,y2);
    }
    const tree = page.getByRole("complementary",{name:"Rig hierarchy"});
    await expect(tree.getByRole("button",{name:"Star 3",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Region select"}).click();
    await drag(75,60,232,165);
    const inspector = page.getByRole("complementary",{name:"Inspector"});
    await expect(inspector.getByText("3 paths selected")).toBeVisible();
    await inspector.getByRole("button",{name:"Align top"}).click();
    await inspector.getByRole("button",{name:"Distribute horizontally"}).click();
    await page.getByRole("button",{name:"Region select"}).click();
    await page.getByRole("combobox",{name:"Region selection mode"}).selectOption("lasso");
    await page.mouse.move(x(75),y(62));
    await page.mouse.down();
    for (const [px,py] of [[236,62],[236,118],[75,118],[75,62]]) {
      await page.mouse.move(x(px),y(py),{steps:5});
    }
    await page.mouse.up();
    await expect(inspector.getByText("3 paths selected")).toBeVisible();
    await tree.getByRole("button",{name:"Rectangle 1",exact:true}).click();
    await page.getByRole("button",{name:"Rulers",exact:true}).click();
    await expect(page.getByRole("button",{name:"Rulers",exact:true})).toHaveAttribute("aria-pressed","true");
    await page.getByRole("button",{name:"Guides",exact:true}).click();
    const guides = page.getByRole("dialog",{name:"Artboard guides"});
    await guides.getByLabel("Position (px)").fill("122");
    await guides.getByRole("button",{name:"Add guide",exact:true}).click();
    await expect(guides.getByRole("button",{name:"Remove vertical guide at 122px"})).toBeVisible();
    await guides.getByRole("button",{name:"Close dialog"}).click();
    await page.getByRole("button",{name:"Snap",exact:true}).click();
    const statePath = path+"/state";
    const saved = async () => (await (await page.request.get(statePath)).json()).state as KinetixRigState;
    const rectangle = async () => (await saved()).parts.find(part=>part.name==="Rectangle 1")!;
    await expect.poll(async()=>{
      const state=await saved();
      return state.version===2 && state.guides?.some(guide=>guide.axis==="x" && guide.position===122);
    }).toBe(true);
    const initial = worldPartBounds(await rectangle(),new Map());
    async function tryGuide() {
      const viewport=(await canvas.boundingBox())!;
      const scale=Math.min(viewport.width/300,viewport.height/240);
      const y=viewport.y+viewport.height/2+((initial.min.y+initial.max.y)/2-120)*scale;
      const from=viewport.x+viewport.width/2+((initial.min.x+initial.max.x)/2-150)*scale;
      await page.mouse.move(from,y);
      await page.mouse.down();
      await page.mouse.move(from+(124.5-initial.min.x)*scale,y,{steps:5});
      await page.mouse.up();
    }
    const savedLeft = async () => {
      return Math.round(worldPartBounds(await rectangle(),new Map()).min.x);
    };
    await tryGuide();
    await expect.poll(savedLeft).toBe(122);
    await page.getByRole("button",{name:"Undo",exact:true}).click();
    await page.keyboard.down("Alt");
    await tryGuide();
    await page.keyboard.up("Alt");
    await expect.poll(savedLeft).toBeGreaterThanOrEqual(123);
    const result = await saved();
    expect(result).toMatchObject({guides:[{axis:"x",position:122}]});
    const vertical = result.parts.map(part=>worldPartBounds(part,new Map()).min.y);
    expect(Math.max(...vertical)-Math.min(...vertical)).toBeLessThan(1.5);
  } finally {
    expect((await page.request.delete(path)).status()).toBe(204);
  }
});

test("an illustrator moves a transformed path with numbers, keys, and the pointer", async ({page},info) => {
  const creation = await page.request.post("/api/rigs",{data:{
    name:"Logo layout " + info.project.name,artboard:{name:"Logo",width:240,height:240,background:null},
  }});
  expect(creation.status()).toBe(201);
  const {id,revision,state} = await creation.json();
  const path = "/api/rigs/" + id;
  try {
    const part = {id:"tile",name:"Tile",parentId:null,offset:{x:0,y:0},closed:true,fill:"#ff3300",
      knots:[{point:{x:20,y:20}},{point:{x:60,y:20}},{point:{x:60,y:60}},{point:{x:20,y:60}}]};
    expect((await page.request.patch(path+"/state",{data:{revision,state:{...state,parts:[part]}}})).status()).toBe(200);
    await page.goto("/studio/"+id);
    await page.getByRole("button",{name:"Tile",exact:true}).click();
    const inspector = page.getByRole("complementary",{name:"Inspector"});
    for (const [name,value] of [
      ["Position X (px)","120"],["Rotation (°)","90"],["Scale X (%)","150"],["Pivot X (px)","20"],["Pivot Y (px)","20"],
    ]) {
      const field = inspector.getByLabel(name,{exact:true});
      await field.fill(value);
      await field.press("Enter");
    }
    const positionX = inspector.getByLabel("Position X (px)",{exact:true});
    const positionY = inspector.getByLabel("Position Y (px)",{exact:true});
    await expect(positionX).toHaveValue("80");
    await expect(positionY).toHaveValue("10");
    const canvas = page.getByRole("img",{name:"Rig canvas"});
    await canvas.focus();
    await expect(canvas).toBeFocused();
    await canvas.press("Control+Shift+ArrowRight");
    await expect(positionX).toHaveValue("90");
    const bounds = (await canvas.boundingBox())!;
    const scale = Math.min(bounds.width,bounds.height)/240;
    const screenX = bounds.x + bounds.width/2 + (90 - 120)*scale;
    const screenY = bounds.y + bounds.height/2 + (60 - 120)*scale;
    await page.mouse.move(screenX,screenY);
    await page.mouse.down();
    await page.mouse.move(screenX+20*scale,screenY+15*scale,{steps:5});
    await page.mouse.up();
    await expect.poll(async () => Math.round(Number(await positionX.inputValue()))).toBe(110);
    await expect.poll(async () => Math.round(Number(await positionY.inputValue()))).toBe(25);
    await page.getByRole("button",{name:"Undo",exact:true}).click();
    await expect(positionX).toHaveValue("90");
    await expect(positionY).toHaveValue("10");
  } finally {
    expect((await page.request.delete(path)).status()).toBe(204);
  }
});

test("an animator keys and plays artwork position without a skeleton", async ({page}, info) => {
  const created = await page.request.post("/api/rigs",{data:{
    name:"Sprite motion " + info.project.name,artboard:{name:"Sprite",width:200,height:180,background:null},
  }});
  expect(created.status()).toBe(201);
  const {id,revision,state} = await created.json();
  const path = "/api/rigs/" + id;
  try {
    const part = {id:"lantern",name:"Lantern",parentId:null,offset:{x:0,y:0},closed:true,fill:"#ff8800",
      knots:[{point:{x:22,y:58}},{point:{x:43,y:58}},{point:{x:43,y:96}},{point:{x:22,y:96}}]};
    expect((await page.request.patch(path+"/state",{data:{revision,state:{...state,parts:[part]}}})).status()).toBe(200);
    const {id:clipId} = await (await page.request.post(path+"/clips",{data:{name:"Swing",fps:12,frameCount:9}})).json();
    await page.goto("/studio/" + id);
    await page.getByRole("button",{name:"Lantern",exact:true}).click();
    const channel = page.getByRole("combobox",{name:"Keyframe channel"});
    await expect(channel.locator("option:checked")).toHaveText("Lantern · X");
    const frame = page.getByRole("slider",{name:"Timeline frame"});
    for (const [at,offset] of [[0,0],[4,64],[8,0]]) {
      await frame.fill(String(at));
      await page.getByLabel("Keyframe value").fill(String(offset));
      await page.getByRole("button",{name:"Insert keyframe"}).click();
    }
    const saved = async () => {
      const response = await page.request.get(path+"/clips/"+clipId+"/tracks");
      return (await response.json()).tracks;
    };
    await expect.poll(saved).toMatchObject([{channel:{kind:"part",id:"lantern",property:"x"},
      keys:[{frame:0,value:0},{frame:4,value:64},{frame:8,value:0}]}]);
    await page.reload();
    await page.getByRole("button",{name:"Lantern x keyframe 5",exact:true}).click();
    await expect(page.getByRole("complementary",{name:"Rig hierarchy"}).getByRole("button",{name:"Lantern"})).toHaveAttribute("aria-pressed","true");
    await expect(page.getByLabel("Keyframe value")).toHaveValue("64");
    const canvas = page.locator("canvas.studio-canvas");
    await expect.poll(() => canvas.evaluate(element => {
      if (!(element instanceof HTMLCanvasElement)) return [];
      const context = element.getContext("2d")!;
      const scale = Math.min(element.width / 200,element.height / 180);
      const sampleAlpha = (x:number) => context.getImageData(
        Math.round(element.width / 2 + (x - 100) * scale),
        Math.round(element.height / 2 + (72 - 90) * scale),1,1,
      ).data[3];
      return [sampleAlpha(30),sampleAlpha(98)];
    })).toEqual([0,255]);
    await page.getByRole("button",{name:"Play timeline"}).click();
    await expect(page.getByRole("button",{name:"Pause timeline"})).toBeVisible();
    await page.getByRole("button",{name:"Pause timeline"}).click();
    await page.getByRole("button",{name:"Export",exact:true}).click();
    const dialog = page.getByRole("dialog",{name:"Export animation"});
    await dialog.getByLabel("Format").selectOption("sprite-package");
    await dialog.getByLabel("Pivot X (px)").fill("33");
    await dialog.getByLabel("Pivot Y (px)").fill("72");
    const download = page.waitForEvent("download");
    await dialog.getByRole("button",{name:"Download sprite package"}).click();
    const artifact = await download;
    expect(artifact.suggestedFilename()).toBe("kinetix-" + clipId + ".zip");
    const files = unzipSync(await readFile(await artifact.path()));
    const manifest = JSON.parse(strFromU8(files["kinetix.json"]));
    expect(manifest.clip).toEqual({name:"Swing",fps:12,loop:true,startFrame:0,endFrame:8});
    expect(manifest.frames).toHaveLength(9);
    expect(manifest.frames[0]).toMatchObject({pivot:{x:33,y:72},durationTicks:1});
    expect(files["atlas.png"].subarray(0,4)).toEqual(new Uint8Array([137,80,78,71]));
  } finally {
    expect((await page.request.delete(path)).status()).toBe(204);
  }
});

test("an illustrator draws, edits, reopens, and exports a blank design", async ({page}, info) => {
  const name = "Portrait design " + info.project.name;
  await page.goto("/dashboard");
  await page.getByRole("button",{name:"New design"}).click();
  await page.getByLabel("Design name").fill(name);
  await page.getByLabel("Artboard name").fill("Portrait");
  await page.getByLabel("Width (px)").fill("240");
  await page.getByLabel("Height (px)").fill("360");
  await page.getByRole("button",{name:"Create design"}).click();
  await expect(page.getByRole("heading",{name})).toBeVisible({timeout:20_000});
  const id = new URL(page.url()).pathname.split("/").at(-1);
  const path = "/api/rigs/" + id;
  try {
    const canvas = page.getByRole("img",{name:"Rig canvas"});
    const bounds = (await canvas.boundingBox())!;
    const scale = Math.min(bounds.width / 240,bounds.height / 360);
    const x = (world:number) => bounds.x + bounds.width / 2 + (world - 120) * scale;
    const y = (world:number) => bounds.y + bounds.height / 2 + (world - 180) * scale;
    for (const polygon of [[[50,112],[190,112],[120,245]],[[55,177],[73,123],[96,163]],[[143,157],[165,110],[183,170]]]) {
      await page.getByRole("button",{name:"Polygon",exact:true}).click();
      for (const [px,py] of polygon) await page.mouse.click(x(px),y(py));
      await page.getByRole("button",{name:"Close polygon"}).click();
    }
    const inspector = page.getByRole("complementary",{name:"Inspector"});
    await inspector.getByLabel("Edge").selectOption("0");
    await inspector.getByRole("button",{name:"Split edge"}).click();
    await expect(inspector.getByLabel("Edge").locator("option")).toHaveCount(5);
    await page.mouse.move(x(143),y(157));
    await page.mouse.down();
    await page.mouse.move(x(130),y(150),{steps:4});
    await page.mouse.up();
    await expect(inspector.getByText("Human · Edit path")).toBeVisible();
    await page.getByRole("button",{name:"Undo",exact:true}).click();
    await expect(inspector.getByText("Human · Split edge")).toBeVisible();
    await page.getByRole("button",{name:"Save",exact:true}).click();
    await expect(page.getByRole("button",{name:"Save",exact:true})).toBeDisabled();
    await page.reload();
    await expect(page.getByRole("button",{name:"Polygon 3",exact:true})).toBeVisible();
    const saved: {state:KinetixRigState} = await (await page.request.get(path+"/state")).json();
    expect(saved.state).toMatchObject({version:2,artboard:{name:"Portrait",width:240,height:360,background:null}});
    expect(saved.state.parts.map(part=>part.knots.length)).toEqual([3,3,4]);
    expect(saved.state.parts[2].knots[0].point.x).toBeCloseTo(143,0);
    await page.getByRole("button",{name:"Export",exact:true}).click();
    const link = page.getByRole("link",{name:"Download saved artboard PNG"});
    const png = await page.request.get((await link.getAttribute("href"))!);
    expect(png.headers()["content-type"]).toBe("image/png");
    const bytes = await png.body();
    expect([bytes.readUInt32BE(16),bytes.readUInt32BE(20),bytes[25]]).toEqual([240,360,6]);
    expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight && document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  } finally {
    expect((await page.request.delete(path)).status()).toBe(204);
  }
});

test("a member queues an export from the studio", async ({page}, info) => {
  const name = "Export " + info.project.name + " rig";
  const created = await page.request.post("/api/rigs", {data:{name,study:"fox"}});
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const path = "/api/rigs/" + id;
  try {
    await page.goto("/studio/"+id);
    await page.getByRole("button",{name:"Export",exact:true}).click();
    const dialog = page.getByRole("dialog",{name:"Export animation"});
    await expect(dialog).toBeVisible();
    const jobList = dialog.getByRole("region",{name:"Export jobs"});
    const byViewport: Record<string,ExportFormat[]> = {
      desktop:["lottie","png-sequence"], tablet:["spritesheet"], mobile:["mp4"], landscape:["webm"],
    };
    for (const format of byViewport[info.project.name] ?? ["lottie"]) {
      const {label,mime,extension} = formats[format];
      await dialog.getByLabel("Format").selectOption(format);
      await dialog.getByLabel("Last frame").fill("4");
      await dialog.getByRole("button",{name:"Queue export"}).click();
      const row = jobList.getByRole("listitem").filter({hasText:label});
      await expect(row.getByText(label,{exact:true})).toBeVisible();
      if (process.env.INNGEST_DEV === "1") {
        const link = row.getByRole("link",{name:"Download"});
        await expect(link).toBeVisible({timeout:35_000});
        const downloaded = await page.request.get((await link.getAttribute("href"))!);
        expect(downloaded.status()).toBe(200);
        expect(downloaded.headers()["content-type"]).toBe(mime);
        expect(downloaded.headers()["content-disposition"]).toContain("." + extension);
        if (format === "lottie") expect(await downloaded.json()).toMatchObject({nm:name,op:4,v:"5.12.2"});
        else expect((await downloaded.body()).length).toBeGreaterThan(100);
      } else {
        await expect(row.getByText("Queued",{exact:true})).toBeVisible();
      }
    }
    await expectStudioViewport(page);
  } finally {
    expect((await page.request.delete(path)).status()).toBe(204);
  }
});

test("a member can author easing, preview onion skins, and paint a closed shape", async ({page}, info) => {
  const name = "Animation " + info.project.name + " rig";
  const created = await page.request.post("/api/rigs", {data:{name,study:"fox"}});
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const path = "/api/rigs/" + id;
  try {
    const response = await page.request.post(path+"/clips",{data:{name:"Walk",fps:24,frameCount:24}});
    expect(response.status()).toBe(201);
    const clip = await response.json();
    await page.goto("/studio/"+id);
    await page.getByRole("button",{name:"Foreleg",exact:true}).click();
    await page.getByLabel("Keyframe value").fill("10");
    await page.getByRole("button",{name:"Insert keyframe"}).click();
    await page.getByRole("slider",{name:"Timeline frame"}).fill("12");
    await page.getByLabel("Keyframe value").fill("90");
    await page.getByRole("button",{name:"Insert keyframe"}).click();
    await page.getByRole("button",{name:"Foreleg rotation keyframe 1",exact:true}).click();
    await page.getByRole("button",{name:"Easing",exact:true}).click();
    const graph = page.getByRole("dialog",{name:"Easing curve"});
    await expect(graph.getByRole("img",{name:"Cubic Bézier curve"})).toBeVisible();
    await graph.getByLabel("Y1").fill("0.6");
    await graph.getByRole("button",{name:"Done",exact:true}).click();
    await expect(page.getByText("Saved",{exact:true})).toBeVisible({timeout:8000});
    const saved = await (await page.request.get(path+"/clips/"+clip.id+"/tracks")).json();
    expect(saved.tracks[0].keys.map((key:{frame:number})=>key.frame)).toEqual([0,12]);
    expect(saved.tracks[0].keys[0].easing.y1).toBe(0.6);
    await page.getByRole("slider",{name:"Timeline frame"}).fill("6");
    const onion = page.getByRole("button",{name:"Onion skin",exact:true});
    await onion.click();
    await expect(onion).toHaveAttribute("aria-pressed","true");

    await page.getByRole("button",{name:"Base pose",exact:true}).click();
    await page.getByRole("button",{name:"Body",exact:true}).click();
    const canvas = page.getByRole("img",{name:"Rig canvas"});
    const box = (await canvas.boundingBox())!;
    const position = (x:number,y:number) => ({ x:box.x + box.width*x, y:box.y + box.height*y });
    const point = position(.30,.30);
    await page.getByRole("button",{name:"Pen",exact:true}).click();
    for (const vertex of [point,position(.50,.30),position(.39,.58)]) await page.mouse.click(vertex.x,vertex.y);
    await page.getByRole("button",{name:"Close shape"}).click();
    await page.getByRole("button",{name:"Bind mesh"}).click();
    await page.getByLabel("Influence bone").selectOption("upper");
    await page.getByRole("button",{name:"Paint weights"}).click();
    await page.mouse.click(point.x,point.y);
    await expect(page.getByText("Saved",{exact:true})).toBeVisible({timeout:8000});
    const state: KinetixRigState = (await (await page.request.get(path+"/state")).json()).state;
    expect(state.parts[0].mesh?.vertices.some(vertex => vertex.weights.some(weight => weight.boneId === "upper"))).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight && document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  } finally {
    expect((await page.request.delete(path)).status()).toBe(204);
  }
});

test("a member can open, manipulate, and save a studio rig", async ({page}, info) => {
  const name = "Playwright " + info.project.name + " rig";
  const created = await page.request.post("/api/rigs", {
    data: { name, study: "fox" },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const path = "/api/rigs/" + id;
  try {
    const fetched = await page.request.get(path + "/state");
    expect(fetched.status()).toBe(200);
    const { revision, state }: { revision: number; state: KinetixRigState } = await fetched.json();
    expect(state.version).toBe(1);
    state.bones[1].rotation = Math.PI / 4;
    const saved = await page.request.patch(path + "/state", { data: { revision, state } });
    expect(saved.status()).toBe(200);
    expect(await saved.json()).toMatchObject({ state, revision: revision + 1 });
    expect((await page.request.patch(path + "/state", { data: { revision, state } })).status()).toBe(409);

    await page.goto("/dashboard");
    await page.getByRole("link",{name,exact:true}).click();
    await expect(page).toHaveURL("/studio/" + id);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading",{name,exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Foreleg",exact:true}).click();
    const rotation = page.getByLabel("Rotation (°)");
    await expect(rotation).toHaveValue("45");
    const canvas = page.getByRole("img",{name:"Rig canvas"});
    await expect(canvas).toBeInViewport({ratio:1});
    const box = (await canvas.boundingBox())!;
    expect(box.height).toBeGreaterThan(95);
    const scale = Math.min(box.width / 510, box.height / 280);
    const project = (point: {x:number;y:number}) => ({
      x:box.x + box.width / 2 + (point.x - 245) * scale,
      y:box.y + box.height / 2 + (point.y - 143) * scale,
    });
    const pose = forwardKinematics(state.bones).get("upper")!;
    const around = (angle:number) => project({
      x:pose.origin.x + 30 * Math.cos(angle), y:pose.origin.y + 30 * Math.sin(angle),
    });
    const from = around(pose.angle);
    const to = around(pose.angle + 0.68);
    await page.mouse.move(from.x,from.y);
    await page.mouse.down();
    await page.mouse.move(to.x,to.y,{steps:6});
    await page.mouse.up();
    await expect(rotation).not.toHaveValue("45");
    await page.getByRole("button",{name:"Undo",exact:true}).click();
    await expect(rotation).toHaveValue("45");
    await page.getByRole("button",{name:"Redo",exact:true}).click();
    await expect(rotation).not.toHaveValue("45");

    const angle = Number(await rotation.inputValue()) * Math.PI / 180;
    const tip = project({
      x:pose.origin.x + state.bones[1].length * Math.cos(angle),
      y:pose.origin.y + state.bones[1].length * Math.sin(angle),
    });
    await page.getByRole("button",{name:"Draw bone",exact:true}).click();
    await page.mouse.move(tip.x,tip.y);
    await page.mouse.down();
    await page.mouse.move(tip.x + 26 * scale,tip.y + 24 * scale,{steps:5});
    await page.mouse.up();
    await expect(page.getByRole("button",{name:"Bone 4"})).toHaveAttribute("aria-pressed","true");
    await page.getByRole("button",{name:"Foreleg",exact:true}).click();

    await page.getByRole("button",{name:"Pen",exact:true}).click();
    await page.mouse.move(box.x + box.width * .33, box.y + box.height * .22);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .40, box.y + box.height * .22,{steps:4});
    await page.mouse.up();
    await page.mouse.click(box.x + box.width * .42, box.y + box.height * .30);
    await page.getByRole("button",{name:"Finish path"}).click();
    await expect(page.getByRole("button",{name:"Path 1"})).toHaveAttribute("aria-pressed","true");
    await expect(page.getByText("Saved",{exact:true})).toBeVisible({timeout:8000});
    await expect(page.getByRole("button",{name:"Save",exact:true})).toBeDisabled();
    const reopened = await page.request.get(path + "/state");
    const edited: KinetixRigState = (await reopened.json()).state;
    expect(edited.parts[0].knots[0].outgoing).toBeDefined();
    expect(edited.bones[1].rotation).not.toBe(state.bones[1].rotation);
    expect(edited.bones[3]).toMatchObject({parentId:"upper",offset:{x:state.bones[1].length,y:0}});
    const panel = info.project.name === "mobile" ? "Resize side panels" : "Resize hierarchy";
    const separator = page.getByRole("separator",{name:panel,exact:true});
    const size = Number(await separator.getAttribute("aria-valuenow"));
    await separator.press("ArrowRight");
    await expect(separator).toHaveAttribute("aria-valuenow", String(size + 8));
    if (info.project.name !== "mobile") {
      const inspector = page.getByRole("separator",{name:"Resize inspector",exact:true});
      const rightSize = Number(await inspector.getAttribute("aria-valuenow"));
      await inspector.press("ArrowLeft");
      await expect(inspector).toHaveAttribute("aria-valuenow", String(rightSize + 8));
    }
    const timeline = page.getByRole("separator",{name:"Resize timeline"});
    const handle = (await timeline.boundingBox())!;
    const timelineSize = Number(await timeline.getAttribute("aria-valuenow"));
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 18);
    await page.mouse.up();
    await expect(timeline).toHaveAttribute("aria-valuenow", String(timelineSize + 18));
    await canvas.focus();
    await page.keyboard.press("P");
    await expect(page.getByRole("button",{name:"Pen",exact:true})).toHaveAttribute("aria-pressed","true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button",{name:"Select",exact:true})).toHaveAttribute("aria-pressed","true");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("slider",{name:"Timeline frame"})).toHaveValue("1");
    await page.keyboard.press("Space");
    await expect(page.getByRole("button",{name:"Pause timeline"})).toBeVisible();
    await page.keyboard.press("Space");
    await page.keyboard.press("?");
    const shortcuts=page.getByRole("dialog",{name:"Keyboard shortcuts"});
    await expect(shortcuts).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(shortcuts).toBeHidden();
    await expectStudioViewport(page);
    await page.screenshot({path:info.outputPath("studio.png")});
  } finally {
    expect((await page.request.delete(path)).status()).toBe(204);
  }
});

test("member library fits the viewport and opens the chosen study",async({page},info)=>{
  await page.getByRole("link",{name:"Rig library"}).click();
  await expect(page.getByRole("heading",{name:"Rig library"})).toBeVisible();
  await expect(page.getByRole("link",{name:/Blue heron/})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"New rig"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight && document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("dashboard.png")});
  await page.getByRole("button",{name:"Motion studies"}).click();
  const studies = page.getByRole("dialog",{name:"Motion studies"});
  await expect(studies.getByRole("link")).toHaveCount(3);
  await studies.getByRole("link",{name:/Blue heron/}).click();
  await expect(page.getByRole("img",{name:/Blue heron/})).toBeVisible();
  await page.getByRole("button",{name:"Play clip"}).click();
  await expect(page.getByRole("slider")).not.toHaveValue("1");
  await page.getByRole("button",{name:"Pause clip"}).click();
  await page.getByRole("slider").fill("18");
  await expect(page.getByRole("img",{name:/frame 18$/})).toBeVisible();
  const bones = page.getByRole("button",{name:"Bones",exact:true});
  await bones.click();
  await expect(bones).toHaveAttribute("aria-pressed","false");
  await page.getByRole("button",{name:"Quick guide"}).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight)).toBe(true);
  const session = await page.request.get("/api/session");
  expect((await session.json()).mode).toBe("member");
});

test("member manages clips in the studio and renames or deletes a rig from its card",async({page},info)=>{
  const name = "Library " + info.project.name + " fox";
  await page.goto("/dashboard");
  await page.getByRole("button",{name:"New rig"}).click();
  await page.getByLabel("Rig name").fill(name);
  await page.getByRole("button",{name:"Create rig"}).click();
  await expect(page.getByRole("heading",{name,exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Manage clips"}).click();
  const detail = page.getByRole("dialog",{name:"Animation clips"});
  await detail.getByRole("button",{name:"New clip"}).click();
  await detail.getByLabel("Clip name").fill("Walk");
  await detail.getByRole("button",{name:"Add clip"}).click();
  await detail.getByRole("button",{name:"Edit Walk"}).click();
  await detail.getByLabel("Clip name").fill("Walk loop");
  await detail.getByRole("button",{name:"Save clip"}).click();
  await expect(detail.getByText("Walk loop",{exact:true})).toBeVisible();
  await detail.getByRole("button",{name:"Close dialog"}).click();
  const picker = page.getByRole("combobox", {name:"Animation clip", exact:true});
  await expect(picker.locator("option:checked")).toHaveText("Walk loop");
  await page.getByRole("button",{name:"Manage clips"}).click();
  await detail.getByRole("button",{name:"Delete Walk loop"}).click();
  await detail.getByRole("button",{name:"Delete clip",exact:true}).click();
  await expect(detail.getByText("No saved clips yet.")).toBeVisible();
  await detail.getByRole("button",{name:"Close dialog"}).click();
  await expect(picker.locator("option:checked")).toHaveText(/Study/);
  await page.getByRole("link",{name:"Rig library"}).click();
  await page.getByRole("button",{name:"Actions for " + name}).click();
  await page.getByRole("button",{name:"Rename rig"}).click();
  const renamed = name + " renamed";
  await page.getByLabel("Rig name").fill(renamed);
  await page.getByRole("button",{name:"Save name"}).click();
  await expect(page.getByRole("link",{name:renamed,exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Actions for " + renamed}).click();
  await page.getByRole("button",{name:"Delete rig"}).click();
  await page.getByRole("dialog",{name:"Delete rig"}).getByRole("button",{name:"Delete rig"}).click();
  await expect(page.getByRole("link",{name:renamed,exact:true})).toHaveCount(0);
});
