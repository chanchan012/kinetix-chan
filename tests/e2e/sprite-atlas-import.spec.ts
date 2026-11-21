import { readFile } from "node:fs/promises";
import { clerk } from "@clerk/testing/playwright";
import { Client,StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect,test } from "@playwright/test";
import type { AtlasReceipt } from "../../lib/import/sequence-options";
import { decodedAtlas,exportedAtlasFixture } from "../fixtures/sprite-atlas";

test.use({actionTimeout:25_000});

async function directionalFrames(bytes:Uint8Array) {
  const bundle=await decodedAtlas(bytes);
  return {...bundle,clips:bundle.clips.toSorted((a,b)=>(a.direction ?? "").localeCompare(b.direction ?? ""))};
}

test("an illustrator imports and re-exports a packed sprite atlas",async({page},info)=>{
  test.setTimeout(140_000);
  await page.goto("/");
  await clerk.signIn({page,emailAddress:process.env.KINETIX_TEST_EMAIL!});
  const archive=Buffer.from(await exportedAtlasFixture());
  const source=await directionalFrames(archive);
  const paths:string[]=[];
  const client=new Client({name:"atlas-parity",version:"1.0.0"});
  async function create(name:string) {
    const response=await page.request.post("/api/rigs",{data:{name,artboard:{name:"Empty",width:16,height:16,background:null}}});
    expect(response.status()).toBe(201);
    const {id,revision}=await response.json() as {id:string;revision:number};
    const path="/api/rigs/"+id;
    paths.push(path);
    return {id,path,revision};
  }

  try {
    const studio=await create(`Sprite atlas ${info.project.name}`);
    await page.goto("/studio/"+studio.id);
    const layers=page.getByRole("region",{name:"Artwork layers"});
    await layers.getByRole("button",{name:"Import sprite bundle"}).click();
    const dialog=page.getByRole("dialog",{name:"Import sprite bundle"});
    await dialog.getByLabel("Sprite bundle ZIP").setInputFiles({name:"Lantern.zip",mimeType:"application/zip",buffer:archive});
    await dialog.getByRole("button",{name:"Check bundle"}).click();
    const preview=dialog.getByRole("region",{name:"Sprite bundle preview"});
    await expect(preview.getByRole("status")).toHaveText("2 clips · 16 × 16 px · packed");
    await expect(preview.getByText("Flicker · east · 107 ticks at 12 fps · once")).toBeVisible();
    await expect(preview.getByText("Flicker · west · 6 ticks at 8 fps · ping-pong")).toBeVisible();
    await expect(preview.getByRole("img",{name:"First visible frame"})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight && document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const saved=page.waitForResponse(response=>response.url().endsWith("/imports/sprite-bundle") && response.request().method()==="POST");
    await dialog.getByRole("button",{name:"Import and create clips"}).click();
    expect((await saved).status()).toBe(201);
    await expect(dialog).toBeHidden();
    const timeline=page.getByRole("region",{name:"Timeline"});
    const clip=timeline.getByLabel("Animation clip");
    await expect(clip.locator("option:checked")).toHaveText("Flicker · east");
    await expect(timeline.getByRole("button",{name:"Lantern blank exposure 101"})).toBeVisible();
    await clip.selectOption({label:"Flicker · west"});
    await expect(timeline.getByLabel("Current frame")).toHaveText("1 / 6");

    await page.getByRole("button",{name:"Export",exact:true}).click();
    const exported=page.getByRole("dialog",{name:"Export animation"});
    await exported.getByLabel("Format").selectOption("sprite-bundle");
    await exported.getByRole("checkbox",{name:"Flicker · east",exact:true}).check();
    await expect(exported.getByLabel("Preserve imported timing and frame metadata").first()).toBeChecked();
    await exported.getByRole("button",{name:"Check export"}).press("Enter");
    await expect(exported.getByRole("region",{name:"Sprite bundle preflight"})).toContainText("2 clips");
    const download=page.waitForEvent("download");
    await exported.getByRole("button",{name:"Download sprite bundle"}).press("Enter");
    expect(await directionalFrames(await readFile(await (await download).path()))).toEqual(source);

    if (info.project.name==="desktop") {
      const agent=await create("MCP sprite atlas");
      const issued=await page.request.post(agent.path+"/mcp-credentials",{data:{label:"Atlas agent"}});
      expect(issued.status()).toBe(201);
      const {token}=await issued.json();
      await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp",page.url()),{
        requestInit:{headers:{Authorization:"Bearer "+token}},
      }));
      const input={archive:archive.toString("base64"),revision:agent.revision,name:"Lantern"};
      const planned=await client.callTool({name:"import_sprite_bundle",arguments:{...input,preflight:true}});
      expect(planned.isError).not.toBe(true);
      expect(planned.content.some(item=>item.type==="image" && item.mimeType==="image/png")).toBe(true);
      const {importId}=planned.structuredContent as AtlasReceipt;
      const applied=await client.callTool({name:"import_sprite_bundle",arguments:{...input,importId}});
      expect(applied.isError).not.toBe(true);
      const receipt=applied.structuredContent as AtlasReceipt;
      expect(receipt).toMatchObject({applied:true,revision:agent.revision+1,importId});
      const result=await client.callTool({name:"export_sprite_bundle",arguments:{revision:receipt.revision,layout:"loose",
        clips:receipt.clips.map(({id,frameCount,trackRevision})=>({id,trackRevision,startFrame:0,endFrame:frameCount-1,preserveImportedTiming:true})),
      }});
      expect(result.isError).not.toBe(true);
      const {base64}=result.structuredContent as {base64:string};
      expect(await directionalFrames(Buffer.from(base64,"base64"))).toEqual(source);
    }
  } finally {
    await client.close().catch(()=>{});
    for (const path of paths) expect((await page.request.delete(path)).status()).toBe(204);
  }
});
