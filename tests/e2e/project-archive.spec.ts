import { readFile } from "node:fs/promises";
import { createClerkClient } from "@clerk/backend";
import { clerk } from "@clerk/testing/playwright";
import { Client,StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect,test,type Page } from "@playwright/test";
import { readProjectArchive,writeProjectArchive } from "../../lib/project/archive";
import type { ProjectReopenReceipt } from "../../lib/project/archive-options";
import { projectArchiveFixture } from "../fixtures/project-archive";

test.use({actionTimeout:25_000});

test("an illustrator reopens an editable project archive in a clean library",async({page,browser},info)=>{
  test.setTimeout(150_000);
  const project=await projectArchiveFixture();
  const seed=writeProjectArchive(project);
  const issuer=createClerkClient({secretKey:process.env.CLERK_SECRET_KEY});
  let recipient:Page=page;
  let account:string|undefined;
  const opened:{page:Page;id:string}[]=[];
  const client=new Client({name:"project-archive-parity",version:"1.0.0"});

  try {
    await page.goto("/");
    await clerk.signIn({page,emailAddress:process.env.KINETIX_TEST_EMAIL!});
    const created=await page.request.post("/api/rigs/project-archive",{data:{
      archive:Buffer.from(seed.bytes).toString("base64"),name:`Portable animation ${info.project.name}`,
    }});
    expect(created.status()).toBe(201);
    const seeded=await created.json() as ProjectReopenReceipt;
    opened.push({page,id:seeded.projectId});
    const sourcePath="/api/rigs/"+seeded.projectId;
    await page.goto("/studio/"+seeded.projectId);
    await page.getByRole("button",{name:"Export",exact:true}).click();
    const exportDialog=page.getByRole("dialog",{name:"Export animation"});
    await exportDialog.getByLabel("Format").selectOption("project-archive");
    await exportDialog.getByRole("button",{name:"Check archive"}).click();
    await expect(exportDialog.getByRole("region",{name:"Project archive preflight"})).toContainText("2 saved clips");
    const download=page.waitForEvent("download");
    await exportDialog.getByRole("button",{name:"Download project archive"}).click();
    const archive=await readFile(await (await download).path());
    const decoded=readProjectArchive(archive);
    expect(decoded.manifest.source.id).toBe(seeded.projectId);
    expect(decoded.state.parts[0].facets).toBeDefined();
    expect(decoded.clips.map(clip=>clip.tracks)).toEqual([project.clips[0].tracks,project.clips[1].tracks]);

    if (info.project.name==="desktop") {
      const email=`archive-${crypto.randomUUID()}+clerk_test@example.com`;
      account=(await issuer.users.createUser({emailAddress:[email],skipPasswordRequirement:true})).id;
      const context=await browser.newContext({baseURL:new URL(page.url()).origin,viewport:{width:1440,height:900}});
      recipient=await context.newPage();
      await recipient.goto("/");
      await clerk.signIn({page:recipient,emailAddress:email});
      expect((await recipient.request.get(sourcePath+"/state")).status()).toBe(404);
    }
    await recipient.goto("/dashboard");
    if (recipient!==page) await expect(recipient.getByRole("link",{name:new RegExp(seeded.name)})).toHaveCount(0);
    await recipient.getByRole("button",{name:"Open project archive"}).click();
    const dialog=recipient.getByRole("dialog",{name:"Open project archive"});
    await dialog.getByLabel("Project ZIP").setInputFiles({name:"invalid.zip",mimeType:"application/zip",buffer:Buffer.from("invalid")});
    await dialog.getByRole("button",{name:"Check archive"}).click();
    await expect(dialog.getByRole("alert")).toContainText("valid Kinetix project ZIP");
    await expect(dialog.getByRole("button",{name:"Open as new project"})).toBeDisabled();
    await dialog.getByLabel("Project ZIP").setInputFiles({name:"archive.kinetix.zip",mimeType:"application/zip",buffer:archive});
    await dialog.getByLabel("Project name").fill("Reopened animation");
    await dialog.getByRole("button",{name:"Check archive"}).click();
    await expect(dialog.getByRole("region",{name:"Project archive preview"})).toContainText("2 saved clips");
    expect(await recipient.evaluate(()=>document.documentElement.scrollHeight<=innerHeight && document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const saved=recipient.waitForResponse(response=>new URL(response.url()).pathname==="/api/rigs/project-archive" && response.status()===201);
    await dialog.getByRole("button",{name:"Open as new project"}).click();
    const receipt=await (await saved).json() as ProjectReopenReceipt;
    opened.push({page:recipient,id:receipt.projectId});
    await expect(recipient.getByRole("heading",{name:"Reopened animation",exact:true})).toBeVisible();
    const targetPath="/api/rigs/"+receipt.projectId;
    const clipControl=recipient.getByLabel("Animation clip");
    const first=decoded.clips.find(clip=>clip.name==="Lantern east")!;
    await clipControl.selectOption(receipt.clipIds[first.id]);
    await expect(recipient.getByRole("button",{name:"Lantern blank exposure 101"})).toBeVisible();
    await expect(recipient.getByRole("button",{name:"Kite artwork",exact:true})).toBeVisible();
    const original=await page.request.get(sourcePath+"/artboard.png");
    const restored=await recipient.request.get(targetPath+"/artboard.png");
    expect(original.ok()).toBe(true);
    expect(restored.ok()).toBe(true);
    expect(await restored.body()).toEqual(await original.body());

    if (recipient!==page) {
      expect((await page.request.get(targetPath+"/state")).status()).toBe(404);
      const issued=await recipient.request.post(targetPath+"/mcp-credentials",{data:{label:"Archive agent",allowArchiveReopen:true}});
      expect(issued.status()).toBe(201);
      const {token}=await issued.json();
      await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp",recipient.url()),{
        requestInit:{headers:{Authorization:"Bearer "+token}},
      }));
      const tools=await client.listTools();
      expect(tools.tools.map(tool=>tool.name)).toContain("reopen_project_archive");
      const params={archive:archive.toString("base64"),name:"MCP reopened animation"};
      const preview=await client.callTool({name:"reopen_project_archive",arguments:{...params,preflight:true}});
      expect(preview.isError).not.toBe(true);
      const result=await client.callTool({name:"reopen_project_archive",arguments:{...params,importId:(preview.structuredContent as ProjectReopenReceipt).importId}});
      expect(result.isError).not.toBe(true);
      const agentCopy=result.structuredContent as ProjectReopenReceipt;
      opened.push({page:recipient,id:agentCopy.projectId});
      expect(agentCopy).toMatchObject({applied:true,reused:false});
      const check=await client.callTool({name:"export_project_archive",arguments:{revision:0,preflight:true,
        clips:decoded.clips.map(clip=>({id:receipt.clipIds[clip.id],trackRevision:0})),
      }});
      expect(check.isError).not.toBe(true);
      expect(check.structuredContent).toMatchObject({manifest:{source:{id:receipt.projectId}},summary:{drawings:1,parts:1}});
    }
  } finally {
    await client.close().catch(()=>{});
    for (const copy of opened.reverse()) await copy.page.request.delete(`/api/rigs/${copy.id}`);
    if (recipient!==page) await recipient.context().close();
    if (account) await issuer.users.deleteUser(account);
  }
});
