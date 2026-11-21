import { readFile } from "node:fs/promises";
import { createClerkClient } from "@clerk/backend";
import { clerk } from "@clerk/testing/playwright";
import { Client,StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect,test,type Page } from "@playwright/test";
import { unzipSync,zipSync } from "fflate";
import { PNG } from "pngjs";
import { readProjectArchive } from "../../lib/project/archive";
import type { ProjectReopenReceipt } from "../../lib/project/archive-options";
import { imageAssetFixture } from "../fixtures/image-assets";

test.use({actionTimeout:25_000});

test("reuses image assets and relinks a portable project",async({page,browser},info)=>{
  test.setTimeout(160_000);
  const png=imageAssetFixture("image/png","#fc1030");
  const webp=imageAssetFixture("image/webp","#28d020");
  const issuer=createClerkClient({secretKey:process.env.CLERK_SECRET_KEY});
  const client=new Client({name:"image-asset-parity",version:"1.0.0"});
  const projects:{owner:Page;id:string}[]=[];
  let recipient=page;
  let account:string|undefined;
  let sourceRequests=0;

  async function artboard(owner:Page,id:string) {
    const response=await owner.request.get(`/api/rigs/${id}/artboard.png`);
    expect(response.status()).toBe(200);
    const frame=PNG.sync.read(await response.body());
    return (x:number,y:number)=>Array.from(frame.data.subarray((y*frame.width+x)*4,(y*frame.width+x)*4+4));
  }

  try {
    await page.goto("/");
    await clerk.signIn({page,emailAddress:process.env.KINETIX_TEST_EMAIL!});
    const response=await page.request.post("/api/rigs",{data:{name:`Image assets ${info.project.name}`,
      artboard:{name:"Asset scene",width:32,height:24,background:null}}});
    expect(response.status()).toBe(201);
    const {id}=await response.json();
    projects.push({owner:page,id});
    await page.goto("/studio/"+id);
    const open=()=>page.getByRole("region",{name:"Artwork layers"}).getByRole("button",{name:"Image assets"}).click();
    const library=page.getByRole("dialog",{name:"Image assets"});
    await open();
    await library.getByLabel("PNG or WebP file").setInputFiles({name:"Lantern.png",mimeType:"image/png",buffer:png});
    await library.getByLabel("New image folder").fill("Props");
    await library.getByRole("button",{name:"Import image",exact:true}).click();
    await expect(library.getByRole("status")).toHaveText("Image added to this project.");
    expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight && document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await library.getByRole("button",{name:"Place artwork"}).click();
    const placement=page.getByRole("region",{name:"Image placement"});
    async function move(x:number,y:number) {
      await placement.getByLabel("Image X (px)").fill(String(x));
      await placement.getByLabel("Image X (px)").press("Enter");
      await placement.getByLabel("Image Y (px)").fill(String(y));
      await placement.getByLabel("Image Y (px)").press("Enter");
    }
    await move(2,2);
    await open();
    await library.getByLabel("Search image assets").fill("Props");
    await library.getByRole("button",{name:/Lantern.*1 placements/}).click();
    await library.getByRole("button",{name:"Place artwork"}).click();
    await move(20,2);
    await open();
    await library.getByRole("button",{name:/Lantern.*2 placements/}).click();
    await library.getByRole("button",{name:"Place reference"}).click();
    const referencePixel=()=>page.getByRole("img",{name:"Rig canvas"}).evaluate(element=>{
      const canvas=element as HTMLCanvasElement;
      const scale=Math.min(canvas.width/32,canvas.height/24);
      return Array.from(canvas.getContext("2d")!.getImageData(Math.floor(canvas.width/2-scale/2),Math.floor(canvas.height/2-scale/2),1,1).data);
    });
    await expect.poll(referencePixel).toEqual([252,16,48,255]);
    await page.getByRole("button",{name:"References",exact:true}).click();
    await expect.poll(referencePixel).not.toEqual([252,16,48,255]);
    await expect(page.getByText("Saved",{exact:true})).toBeVisible();
    const original=await artboard(page,id);
    expect(original(3,3)).toEqual([252,16,48,255]);
    expect(original(21,3)).toEqual(original(3,3));
    expect(original(15,11)).toEqual([0,0,0,0]);

    await open();
    await library.getByRole("button",{name:/Lantern.*3 placements/}).click();
    await library.getByRole("button",{name:"Replace image",exact:true}).click();
    await library.getByLabel("Replacement PNG or WebP").setInputFiles({name:"Green.webp",mimeType:"image/webp",buffer:webp});
    await library.getByRole("button",{name:"Apply replacement"}).click();
    await expect(library.getByRole("status")).toHaveText("Image replaced in every placement.");
    await library.getByRole("button",{name:"Close dialog"}).click();
    await expect(page.getByText("Saved",{exact:true})).toBeVisible();
    const updated=await artboard(page,id);
    expect(updated(3,3)[1]).toBeGreaterThan(195);
    expect(updated(3,3)).toEqual(updated(21,3));
    expect(updated(15,11)).toEqual([0,0,0,0]);

    await page.getByRole("button",{name:"Export",exact:true}).click();
    const exportDialog=page.getByRole("dialog",{name:"Export animation"});
    await exportDialog.getByLabel("Format").selectOption("project-archive");
    const download=page.waitForEvent("download");
    await exportDialog.getByRole("button",{name:"Download project archive"}).click();
    const archive=await readFile(await (await download).path());
    const decoded=readProjectArchive(archive);
    expect(decoded.manifest.version).toBe(2);
    expect(decoded.state.images?.sources).toHaveLength(1);
    const assetId=decoded.state.images!.assets[0].id;

    if (info.project.name==="desktop") {
      const email=`img-copy-${crypto.randomUUID()}+clerk_test@example.com`;
      account=(await issuer.users.createUser({emailAddress:[email],skipPasswordRequirement:true})).id;
      const context=await browser.newContext({baseURL:new URL(page.url()).origin,viewport:{width:1440,height:900}});
      await context.route(`**/api/rigs/${id}/**`,route=>{sourceRequests++;return route.abort();});
      recipient=await context.newPage();
      await recipient.goto("/");
      await clerk.signIn({page:recipient,emailAddress:email});
    }
    await recipient.goto("/dashboard");
    await recipient.getByRole("button",{name:"Open project archive"}).click();
    const reopen=recipient.getByRole("dialog",{name:"Open project archive"});
    const files=unzipSync(archive);
    if (recipient!==page) delete files[Object.keys(files).find(path=>path.startsWith("images/"))!];
    const upload=recipient!==page ? Buffer.from(zipSync(files)) : archive;
    await reopen.getByLabel("Project ZIP").setInputFiles({name:"scene.kinetix.zip",mimeType:"application/zip",buffer:upload});
    await reopen.getByLabel("Project name").fill("Image archive copy");
    await reopen.getByRole("button",{name:"Check archive"}).click();
    await expect(reopen.getByRole("region",{name:"Project archive preview"})).toContainText("1 image assets");
    if (recipient!==page) await expect(reopen.getByText(/relink these files/)).toBeVisible();
    const imported=recipient.waitForResponse(response=>new URL(response.url()).pathname==="/api/rigs/project-archive" && response.status()===201);
    await reopen.getByRole("button",{name:"Open as new project"}).click();
    const receipt=await (await imported).json() as ProjectReopenReceipt;
    projects.push({owner:recipient,id:receipt.projectId});
    await expect(recipient.getByRole("heading",{name:"Image archive copy",exact:true})).toBeVisible();
    if (recipient===page) {
      expect((await artboard(page,receipt.projectId))(3,3)).toEqual(updated(3,3));
      return;
    }

    const copy=`/api/rigs/${receipt.projectId}`;
    expect((await recipient.request.get(copy+"/artboard.png")).status()).toBe(422);
    await recipient.getByRole("button",{name:"Image assets",exact:true}).click();
    const relink=recipient.getByRole("dialog",{name:"Image assets"});
    await relink.getByRole("button",{name:/Lantern.*Missing/}).click();
    await relink.getByRole("button",{name:"Relink image",exact:true}).click();
    await relink.getByLabel("Replacement PNG or WebP").setInputFiles({name:"Green.webp",mimeType:"image/webp",buffer:webp});
    await relink.getByRole("button",{name:"Apply replacement"}).click();
    await expect(relink.getByRole("status")).toHaveText("Image replaced in every placement.");
    await relink.getByRole("button",{name:"Close dialog"}).click();
    await expect(recipient.getByText("Saved",{exact:true})).toBeVisible();
    expect((await artboard(recipient,receipt.projectId))(21,3)).toEqual(updated(21,3));
    expect(sourceRequests).toBe(0);

    const token=await recipient.request.post(copy+"/mcp-credentials",{data:{label:"Image parity"}});
    expect(token.status()).toBe(201);
    const {token:credential}=await token.json();
    await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp",recipient.url()),{
      requestInit:{headers:{Authorization:`Bearer ${credential}`}},
    }));
    const asset=await client.callTool({name:"read_image_asset",arguments:{id:assetId}});
    expect(asset.isError).not.toBe(true);
    expect(asset.content.some(item=>item.type==="image" && item.mimeType==="image/webp")).toBe(true);
    const current=asset.structuredContent as {revision:number};
    const edited=await client.callTool({name:"import_image_asset",arguments:{revision:current.revision,id:assetId,
      name:"Lantern",folder:"Props",base64:png.toString("base64")}});
    expect(edited.isError).not.toBe(true);
    const result=await artboard(recipient,receipt.projectId);
    expect(result(3,3)).toEqual(original(3,3));
    expect(result(21,3)).toEqual(original(21,3));
  } finally {
    await client.close().catch(()=>{});
    for (const project of projects.reverse()) await project.owner.request.delete(`/api/rigs/${project.id}`);
    if (recipient!==page) await recipient.context().close();
    if (account) await issuer.users.deleteUser(account);
  }
});
