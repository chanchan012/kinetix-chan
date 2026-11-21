import { clerk } from "@clerk/testing/playwright";
import { Client,StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect,test } from "@playwright/test";
import { unzipSync } from "fflate";
import { PNG } from "pngjs";
import type { SequenceReceipt } from "../../lib/import/sequence-options";
import type { KinetixRigState } from "../../lib/rig/model";
import { exportedSequenceFixture } from "../fixtures/png-sequence";

test("an illustrator imports a timed PNG sequence and edits its held cels",async({page},info)=>{
  test.setTimeout(120_000);
  await page.goto("/");
  await clerk.signIn({page,emailAddress:process.env.KINETIX_TEST_EMAIL!});
  const archive=exportedSequenceFixture();
  const source=unzipSync(archive);
  const paths:string[]=[];
  const client=new Client({name:"sequence-parity",version:"1.0.0"});

  async function create(name:string) {
    const response=await page.request.post("/api/rigs",{data:{name,artboard:{name:"Empty",width:16,height:16,background:null}}});
    expect(response.status()).toBe(201);
    const {id,revision}=await response.json() as {id:string;revision:number};
    const path="/api/rigs/"+id;
    paths.push(path);
    return {id,path,revision};
  }
  async function reexport(path:string,revision:number,clipId:string) {
    const response=await page.request.post(path+"/sprite-bundle",{data:{layout:"loose",revision,clips:[{
      id:clipId,trackRevision:0,startFrame:0,endFrame:6,
    }]}});
    expect(response.status()).toBe(200);
    const files=unzipSync(await response.body());
    return Array.from({length:7},(_,index)=>PNG.sync.read(Buffer.from(files[`frames/${String(index+1).padStart(5,"0")}.png`])).data);
  }

  try {
    const studio=await create(`PNG sequence ${info.project.name}`);
    await page.goto("/studio/"+studio.id);
    const layers=page.getByRole("region",{name:"Artwork layers"});
    const start=()=>layers.getByRole("button",{name:"Import PNG sequence",exact:true}).click();
    await start();
    const dialog=page.getByRole("dialog",{name:"Import PNG sequence"});
    await dialog.getByLabel("ZIP or numbered PNG files").setInputFiles({name:"Firefly.zip",mimeType:"application/zip",buffer:archive});
    await dialog.getByLabel("Frame rate without a manifest").fill("30");
    await dialog.getByLabel("Match the empty artboard to the images").check();
    await dialog.getByRole("button",{name:"Check sequence"}).click();
    const preview=dialog.getByRole("region",{name:"PNG sequence preview"});
    await expect(preview.getByRole("status")).toHaveText("7 frames at 18 fps · 32 × 24 px");
    await expect(preview.getByRole("img",{name:"First visible frame"})).toBeVisible();
    await expect(preview.getByText(/3 editable cels.*1 transparent frames/)).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight && document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const imported=page.waitForResponse(response=>response.url().endsWith("/imports/png-sequence") && response.request().method()==="POST");
    await dialog.getByRole("button",{name:"Import and create clip"}).click();
    const response=await imported;
    expect(response.status()).toBe(201);
    const {receipt}=await response.json() as {receipt:SequenceReceipt};
    await expect(dialog).toBeHidden();
    await expect(layers.getByRole("button",{name:"Firefly",exact:true})).toHaveAttribute("aria-pressed","true");
    await expect(page.getByLabel("Animation clip")).toHaveValue(receipt.clip.id);
    await expect(page.getByRole("button",{name:"Firefly blank exposure 3"})).toBeVisible();
    const untouched=await reexport(studio.path,receipt.revision,receipt.clip.id);
    expect(untouched).toEqual(Array.from({length:7},(_,index)=>
      PNG.sync.read(Buffer.from(source[`frames/${String(index+4).padStart(5,"0")}.png`])).data));

    if (info.project.name==="desktop") {
      const agent=await create("PNG sequence through MCP");
      const issued=await page.request.post(agent.path+"/mcp-credentials",{data:{label:"Sequence agent"}});
      expect(issued.status()).toBe(201);
      const {token}=await issued.json();
      await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp",page.url()),{
        requestInit:{headers:{Authorization:"Bearer "+token}},
      }));
      const args={archive:archive.toString("base64"),revision:agent.revision,resizeArtboard:true,name:"Firefly"};
      const preflight=await client.callTool({name:"import_png_sequence",arguments:{...args,preflight:true}});
      expect(preflight.isError).not.toBe(true);
      expect(preflight.content.some(item=>item.type==="image" && item.mimeType==="image/png")).toBe(true);
      const planned=preflight.structuredContent as SequenceReceipt;
      const result=await client.callTool({name:"import_png_sequence",arguments:{...args,importId:planned.importId}});
      expect(result.isError).not.toBe(true);
      const saved=result.structuredContent as SequenceReceipt;
      expect(saved).toMatchObject({applied:true,clip:{fps:18,frameCount:7},heldFrames:3,blankFrames:1});
      expect(await reexport(agent.path,saved.revision,saved.clip.id)).toEqual(untouched);
    }

    const drawingPanel=page.getByLabel("Drawing tools",{exact:true});
    await expect(drawingPanel.getByText("Frame 1",{exact:true})).toBeVisible();
    const canvas=(await page.getByRole("img",{name:"Rig canvas"}).boundingBox())!;
    const scale=Math.min(canvas.width/32,canvas.height/24);
    await page.mouse.click(canvas.x+canvas.width/2+(14.5-16)*scale,canvas.y+canvas.height/2+(9.5-12)*scale);
    let editedRevision=receipt.revision;
    await expect.poll(async()=>{
      const response=await page.request.get(studio.path+"/state");
      if (!response.ok()) return 0;
      const result=await response.json() as {revision:number;state:KinetixRigState};
      editedRevision=result.revision;
      return result.state.drawings?.layers[0].cels[0].runs.length;
    },{intervals:[300,650,1100]}).toBe(3);
    const edited=await reexport(studio.path,editedRevision,receipt.clip.id);
    expect(edited[0]).not.toEqual(untouched[0]);
    expect(edited[1]).toEqual(edited[0]);
    expect(edited.slice(2)).toEqual(untouched.slice(2));
    await page.reload();
    await expect(page.getByLabel("Animation clip")).toHaveValue(receipt.clip.id);
    await expect(layers.getByRole("button",{name:"Firefly",exact:true})).toBeVisible();
    if (info.project.name==="desktop") {
      await start();
      await dialog.getByLabel("ZIP or numbered PNG files").setInputFiles([
        {name:"Scene10.png",mimeType:"image/png",buffer:Buffer.from(source["frames/00007.png"])},
        {name:"Scene9.png",mimeType:"image/png",buffer:Buffer.from(source["frames/00004.png"])},
      ]);
      await dialog.getByLabel("Frame rate without a manifest").fill("30");
      await dialog.getByRole("button",{name:"Check sequence"}).click();
      await expect(preview.getByRole("status")).toHaveText("2 frames at 30 fps · 32 × 24 px");
      await expect(preview.getByText(/Source frames 9–10/)).toBeVisible();
      await dialog.getByRole("button",{name:"Import and create clip"}).click();
      await expect(page.getByLabel("Animation clip").locator("option:checked")).toHaveText("Scene");
      await expect(layers.getByRole("button",{name:"Scene",exact:true})).toHaveAttribute("aria-pressed","true");
    }
  } finally {
    await client.close().catch(()=>{});
    for (const path of paths) expect((await page.request.delete(path)).status()).toBe(204);
  }
});
