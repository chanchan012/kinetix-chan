import { expect, test } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { editRig } from "../../lib/rig/commands";

test.use({actionTimeout:25_000});

test("an illustrator preflights and plays three layouts of a portable sprite bundle",async ({page},info)=>{
  test.setTimeout(150_000);
  await page.goto("/");
  await clerk.signIn({page,emailAddress:process.env.KINETIX_TEST_EMAIL!});
  const created=await page.request.post("/api/rigs",{data:{name:"Portable flicker "+info.project.name,
    artboard:{name:"Flame",width:32,height:32,background:null}}});
  expect(created.status()).toBe(201);
  const {id,revision,state}=await created.json();
  const path="/api/rigs/"+id;
  try {
    const createClip=async(name:string)=>{
      const clip=await page.request.post(path+"/clips",{data:{name,fps:12,frameCount:3}});
      expect(clip.status()).toBe(201);
      return (await clip.json()).id as string;
    };
    const east=await createClip("Flicker East");
    const west=await createClip("Flicker West");
    const drawingId="flame";
    const [art]=editRig(state,[
      {type:"drawing.create",drawing:{id:drawingId,name:"Flame",width:32,height:32,
        storage:{mode:"indexed",colors:["#ff0040","#0066cc"]}}},
      {type:"cel.create",drawingId,id:"tall"},
      {type:"cel.replace",drawingId,id:"tall",runs:[
        [8,6,1,255],[9,6,1,255],[10,5,2,255],[11,5,3,255],[12,5,3,255],[13,6,2,255],
      ]},
      {type:"cel.create",drawingId,id:"wide"},
      {type:"cel.replace",drawingId,id:"wide",runs:[[12,15,5,511],[13,15,5,511]]},
      {type:"exposure.set",drawingId,clipId:east,key:{frame:0,celId:"tall"}},
      {type:"exposure.set",drawingId,clipId:east,key:{frame:1,celId:null}},
      {type:"exposure.set",drawingId,clipId:east,key:{frame:2,celId:"wide"}},
      {type:"exposure.set",drawingId,clipId:west,key:{frame:0,celId:"wide"}},
    ]);
    expect((await page.request.patch(path+"/state",{data:{revision,state:art}})).status()).toBe(200);
    await page.goto("/studio/"+id);
    await page.getByRole("button",{name:"Export",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"Export animation"});
    await dialog.getByLabel("Format").selectOption("sprite-bundle");
    await dialog.getByRole("checkbox",{name:"Flicker East",exact:true}).check();
    await dialog.getByRole("checkbox",{name:"Flicker West",exact:true}).check();
    await dialog.getByText("Frame metadata",{exact:true}).first().click();
    await dialog.getByLabel("Frame metadata (JSON)").first().fill('[{"frame":0,"durationTicks":3,"events":[{"name":"light","tick":2}]}]');
    await dialog.getByLabel("Direction").first().fill("east");
    await dialog.getByLabel("Direction").last().fill("west");
    await dialog.getByLabel("Texture filtering").selectOption("linear");
    await dialog.getByLabel("Maximum texture size").fill("64");
    const archives:{layout:string;buffer:Buffer}[]=[];
    for (const layout of ["loose","fixed-grid","packed"]) {
      await dialog.getByLabel("Sprite layout").selectOption(layout);
      if (layout==="packed") await dialog.getByLabel("Allow 90° rotation").check();
      await dialog.getByRole("button",{name:"Check export"}).press("Enter");
      await expect(dialog.getByRole("region",{name:"Sprite bundle preflight"})).toContainText("2 clips");
      const downloaded=page.waitForEvent("download",{timeout:12_000});
      await dialog.getByRole("button",{name:"Download sprite bundle"}).press("Enter");
      const buffer=await readFile(await (await downloaded).path());
      const manifest=JSON.parse(strFromU8(unzipSync(buffer)["kinetix.json"]));
      expect(manifest.version).toBe(2);
      expect(manifest.layout).toBe(layout);
      expect(manifest.clips[0].frames[0].durationTicks).toBe(3);
      expect(manifest.clips[0].frames[0].rotation).toBe(layout==="packed"?90:0);
      archives.push({layout,buffer});
    }
    await dialog.getByLabel("Format").selectOption("fixed-sprites");
    await dialog.getByRole("checkbox",{name:"Flicker East",exact:true}).check();
    await dialog.getByRole("checkbox",{name:"Flicker West",exact:true}).uncheck();
    await dialog.getByText("Frame metadata",{exact:true}).click();
    await dialog.getByLabel("Frame metadata (JSON)").fill('[{"frame":0,"durationTicks":3,"events":[{"name":"light","tick":2}]}]');
    await dialog.getByLabel("Output FPS").fill("10");
    await dialog.getByRole("button",{name:"Check export"}).press("Enter");
    const fixedPlan=dialog.getByRole("region",{name:"Sprite bundle preflight"});
    await expect(fixedPlan).toContainText("4 frames at 10 FPS");
    await expect(fixedPlan).toContainText("1 hold skipped");
    const fixedDownload=page.waitForEvent("download");
    await dialog.getByRole("button",{name:"Download sprite bundle"}).press("Enter");
    const fixed=unzipSync(await readFile(await (await fixedDownload).path()));
    const timing=JSON.parse(strFromU8(fixed["timing.json"]));
    expect(timing).toMatchObject({schema:"kinetix.fixed-sprites",fps:10,cell:{width:32,height:32},
      clips:[{id:east,totalFrames:4,cues:[{name:"light",sourceTick:2,outputFrame:2}]}],
    });
    expect(fixed[`${east}/sheet-00001.png`]).toBeDefined();
    await page.goto("/sprite-player");
    const schema=await page.request.get("/sprite-player/schema");
    expect(schema.headers()["content-type"]).toContain("application/schema+json");
    expect(await schema.json()).toMatchObject({properties:{version:{const:2}}});
    const importerDownload=page.waitForEvent("download");
    await page.getByRole("link",{name:"Godot importer"}).click();
    const importer=await importerDownload;
    expect(importer.suggestedFilename()).toBe("kinetix-godot-importer.zip");
    const scripts=unzipSync(await readFile(await importer.path()));
    expect(Object.keys(scripts).sort()).toEqual([
      "README.md","import_sprite_bundle.gd","import_sprite_package.gd","kinetix_sprite.gd",
    ]);
    expect(strFromU8(scripts["import_sprite_bundle.gd"])).toContain("func import_bundle");
    const starterDownload=page.waitForEvent("download");
    await page.getByRole("link",{name:"Phaser starter",exact:true}).click();
    const starter=await starterDownload;
    expect(starter.suggestedFilename()).toBe("kinetix-phaser-starter.zip");
    const starterFiles=unzipSync(await readFile(await starter.path()));
    expect(JSON.parse(strFromU8(starterFiles["package.json"]))).toMatchObject({
      name:"kinetix-phaser-starter",dependencies:{phaser:"3.90.0"},
    });
    expect(starterFiles["integrations/phaser/starter/index.html"]).toBeDefined();
    expect(starterFiles["lib/export/sprite-playback.ts"]).toBeDefined();
    const pixiDownload=page.waitForEvent("download");
    await page.getByRole("link",{name:"PixiJS starter",exact:true}).click();
    const pixi=await pixiDownload;
    expect(pixi.suggestedFilename()).toBe("kinetix-pixi-starter.zip");
    const pixiFiles=unzipSync(await readFile(await pixi.path()));
    expect(JSON.parse(strFromU8(pixiFiles["package.json"]))).toMatchObject({
      name:"kinetix-pixi-starter",dependencies:{"pixi.js":"8.23.0"},
    });
    expect(pixiFiles["integrations/pixi/starter/index.html"]).toBeDefined();
    expect(pixiFiles["package-lock.json"]).toBeDefined();
    const kitDownload=page.waitForEvent("download");
    await page.getByRole("link",{name:"Engine conformance kit",exact:true}).click();
    const kit=await kitDownload;
    expect(kit.suggestedFilename()).toBe("kinetix-sprite-conformance.zip");
    const kitFiles=unzipSync(await readFile(await kit.path()));
    expect(kitFiles["examples/source-v2.zip"]).toBeDefined();
    expect(kitFiles["examples/grid-24.zip"]).toBeDefined();
    expect(kitFiles["examples/frames-24.zip"]).toBeDefined();
    const canvas=page.getByRole("img",{name:"Sprite preview"});
    const sample=()=>canvas.evaluate(element=>{
      const canvas=element as HTMLCanvasElement;
      return Array.from(canvas.getContext("2d")!.getImageData(280,173,65,48).data);
    });
    let reference:number[]|undefined;
    for (const {layout,buffer} of archives) {
      await page.getByLabel("Portable sprite ZIP").setInputFiles({name:layout+".zip",mimeType:"application/zip",buffer});
      await expect(page.getByRole("option",{name:"Flicker West · west"})).toBeAttached();
      const frame=page.getByLabel("Current sprite frame");
      await expect(frame).toHaveText("1 · 3 ticks");
      if (await page.getByLabel("Show pivot").isChecked()) await page.getByLabel("Show pivot").uncheck();
      await page.getByLabel("Display scale").selectOption("1.25");
      await expect.poll(async()=>(await sample()).some(value=>value>0)).toBe(true);
      const pixels=await sample();
      if (reference) expect(pixels).toEqual(reference);
      reference ??= pixels;
      await page.getByLabel("Frame",{exact:true}).fill("1");
      await expect(frame).toHaveText("2 · 1 tick · blank");
      await expect.poll(async()=>(await sample()).every(value=>value===0)).toBe(true);
      await page.getByRole("combobox",{name:"Clip",exact:true}).selectOption(west);
      await expect(frame).toHaveText("1 · 1 tick");
      expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBeLessThanOrEqual(
        await page.evaluate(()=>window.innerHeight),
      );
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(()=>window.innerWidth),
      );
    }
  } finally {
    expect((await page.request.delete(path)).status()).toBe(204);
  }
});
