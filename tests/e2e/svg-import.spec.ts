import { readFile } from "node:fs/promises";
import { clerk } from "@clerk/testing/playwright";
import { Client,StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect,test } from "@playwright/test";
import type { KinetixRigState } from "../../lib/rig/model";

test("an illustrator imports an editable SVG and shares the same delivery with MCP",async({page},info)=>{
  test.setTimeout(120_000);
  await page.goto("/");
  await clerk.signIn({page,emailAddress:process.env.KINETIX_TEST_EMAIL!});
  const fixture=await readFile("tests/fixtures/layered-artwork.svg");
  const paths:string[]=[];
  const create=async(name:string)=>{
    const response=await page.request.post("/api/rigs",{data:{name,
      artboard:{name:"Artwork",width:120,height:96,background:null}}});
    expect(response.status()).toBe(201);
    const rig=await response.json();
    paths.push("/api/rigs/"+rig.id);
    return rig as {id:string;revision:number};
  };
  const download=async(path:string)=>{
    const response=await page.request.get(path+"/artboard.png");
    expect(response.ok()).toBe(true);
    return response.body();
  };
  const client=new Client({name:"svg-parity",version:"1.0.0"});
  try {
    const rig=await create("SVG illustrator "+info.project.name);
    const path=paths[0];
    await page.goto("/studio/"+rig.id);
    const layers=page.getByRole("region",{name:"Artwork layers"});
    await layers.getByRole("button",{name:"Import SVG",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"Import SVG"});
    await dialog.getByLabel("SVG file").setInputFiles({name:"Lantern design.svg",mimeType:"image/svg+xml",buffer:fixture});
    await expect(dialog.getByRole("status")).toHaveText("4 editable paths · 120 × 96 px");
    await expect(dialog.getByRole("img",{name:"Imported SVG preview"})).toBeVisible();
    await expect(dialog.getByText("text #Caption",{exact:false})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      await page.evaluate(()=>window.innerHeight));
    await dialog.getByRole("button",{name:"Import editable artwork"}).click();
    const layer=(name:string)=>layers.getByRole("button",{name,exact:true});
    await expect(layer("Lantern design")).toBeVisible();
    await expect(layer("Highlights")).toBeVisible();
    await expect(layer("Slit").locator("xpath=..")).toHaveAttribute("data-hidden","true");
    const saved=async()=>{
      const response=await page.request.get(path+"/state");
      return (await response.json()).state as KinetixRigState;
    };
    await expect.poll(async()=>(await saved()).parts.length).toBe(6);
    await page.getByRole("button",{name:"Undo",exact:true}).click();
    await expect(layer("Lantern design")).toHaveCount(0);
    await page.getByRole("button",{name:"Redo",exact:true}).click();
    await expect(layer("Lantern design")).toBeVisible();
    await expect.poll(async()=>(await saved()).parts.length).toBe(6);
    const originalPng=await download(path);

    if (info.project.name==="desktop") {
      const agentRig=await create("SVG agent");
      const tokenResponse=await page.request.post(paths[1]+"/mcp-credentials",{data:{label:"SVG artist"}});
      const {token}=await tokenResponse.json();
      expect(tokenResponse.status()).toBe(201);
      await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp",page.url()),{
        requestInit:{headers:{Authorization:"Bearer "+token}},
      }));
      const args={revision:agentRig.revision,svg:fixture.toString("utf8"),name:"Lantern design"};
      const preview=await client.callTool({name:"import_svg",arguments:{...args,preflight:true}});
      expect(preview.isError).not.toBe(true);
      expect(preview.structuredContent).toMatchObject({ready:true,applied:false,partCount:4,maskCount:2});
      const planned=preview.structuredContent as {importId:string;groupId:string};
      expect(planned).toMatchObject({importId:expect.any(String),groupId:expect.any(String)});
      const applied=await client.callTool({name:"import_svg",arguments:{...args,importId:planned.importId}});
      expect(applied.isError).not.toBe(true);
      expect(applied.structuredContent).toMatchObject({applied:true,groupId:planned.groupId});
      expect(await download(paths[1])).toEqual(originalPng);
    }

    await layer("Badge").click();
    const inspector=page.getByRole("complementary",{name:"Inspector"});
    await inspector.getByText("Appearance",{exact:true}).click();
    await expect(inspector.getByLabel("Fill rule")).toHaveValue("nonzero");
    await inspector.getByLabel("Fill color",{exact:true}).fill("#cc3300");
    await expect.poll(async()=>(await saved()).parts.find(part=>part.name==="Badge")?.appearance?.fill)
      .toMatchObject({kind:"solid",color:"#cc3300"});
    expect(await download(path)).not.toEqual(originalPng);
    await page.reload();
    await expect(layer("Lantern design")).toBeVisible();
    await expect(layer("Badge")).toBeVisible();
  } finally {
    await client.close().catch(()=>{});
    for (const path of paths) expect((await page.request.delete(path)).status()).toBe(204);
  }
});
