import { resolve } from "node:path";
import { clerk } from "@clerk/testing/playwright";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, test } from "@playwright/test";
import { inputs } from "../../lib/mcp/actions";

test("an MCP agent rigs a character and a walk cycle appears in the live studio",async({page},info)=>{
  test.skip(info.project.name!=="desktop","Runs the complete MCP agent and stdio flow once.");
  test.setTimeout(120_000);
  await page.goto("/");
  await clerk.signIn({page,emailAddress:process.env.KINETIX_TEST_EMAIL!});
  const origin = new URL(page.url()).origin;
  const rigs: string[] = [];
  const client = new Client({name:"kinetix-e2e",version:"1.0.0"});
  const stdio = new Client({name:"kinetix-stdio-e2e",version:"1.0.0"});
  async function rig(name:string) {
    const response = await page.request.post("/api/rigs",{data:{name,study:"fox"}});
    expect(response.status()).toBe(201);
    const {id} = await response.json();
    rigs.push("/api/rigs/"+id);
    return id as string;
  }
  async function call(name:string,args:Record<string,unknown>) {
    const response = await client.callTool({name,arguments:args});
    expect(response.isError, name).not.toBe(true);
    return response.structuredContent as Record<string,unknown>;
  }
  try {
    const id = await rig("MCP rig");
    const unrelated = await rig("Outside MCP scope");
    const separate = await (await page.request.post("/api/rigs/"+unrelated+"/clips",{
      data:{name:"Outside the rig",fps:24,frameCount:24},
    })).json();
    await page.goto("/studio/"+id);
    const room = page.getByRole("group",{name:"Collaborators"});
    await expect(room.getByRole("status",{name:"Collaboration connected"})).toBeVisible();
    await page.getByRole("button",{name:"MCP",exact:true}).click();
    const setup = page.getByRole("dialog",{name:"MCP setup"});
    await setup.getByLabel("Credential name").fill("Walk agent");
    await setup.getByRole("button",{name:"Create credential"}).click();
    await expect(setup.getByRole("list",{name:"Rig credentials"}).getByText(/Walk agent/)).toBeVisible();
    const config = JSON.parse(await setup.locator("pre").innerText());
    const authorization: string = config.headers.Authorization;
    expect(authorization.startsWith("Bearer kinetix_")).toBe(true);
    const endpoint = new URL("/api/mcp",origin);
    await setup.getByRole("button",{name:"Close",exact:true}).click();
    await client.connect(new StreamableHTTPClientTransport(endpoint,{
      requestInit:{headers:{Authorization:authorization}},
    }));
    const {tools} = await client.listTools();
    const scopedTools=Object.keys(inputs).filter(name=>name!=="reopen_project_archive").sort();
    expect(tools.map(tool=>tool.name).sort()).toEqual(scopedTools);
    const {resources} = await client.listResources();
    expect(resources.map(resource=>resource.name).sort()).toEqual(["rig-hierarchy","timeline-summary","viewport-bounds"]);
    const bounds = await client.readResource({uri:"kinetix://viewport-bounds"});
    const content = bounds.contents[0];
    expect("text" in content && JSON.parse(content.text)).toMatchObject({rigId:id,width:510,height:280,yAxis:"down"});
    await call("create_bone",{bone:{id:"agent-thigh",name:"Agent thigh",parentId:"root",offset:{x:70,y:0},length:34,rotation:1.2}});
    await call("create_bone",{bone:{id:"agent-shin",name:"Agent shin",parentId:"agent-thigh",offset:{x:34,y:0},length:27,rotation:0.4}});
    await call("attach_ik_constraint",{constraint:{id:"agent-foot",upperId:"agent-thigh",lowerId:"agent-shin",target:{x:290,y:195},bend:1}});
    await call("draw_vector_part",{part:{id:"agent-leg",name:"Agent leg",parentId:"agent-thigh",offset:{x:0,y:0},fill:"#be4925",closed:true,
      knots:[{point:{x:0,y:-5}},{point:{x:32,y:-4}},{point:{x:31,y:5}},{point:{x:0,y:6}}]}});
    await call("bind_mesh_weights",{partId:"agent-leg",boneId:"agent-thigh"});
    await expect(page.getByRole("button",{name:"Agent thigh",exact:true})).toBeVisible({timeout:9000});
    await expect(room.getByRole("img",{name:/^AI ·/})).toBeVisible({timeout:9000});
    const clip = await call("create_animation_clip",{name:"Agent walk",fps:24,frameCount:24});
    const target = {kind:"ik",id:"agent-foot",property:"x"};
    await call("insert_keyframe",{clipId:clip.id,channel:target,frame:0,value:290});
    await call("set_easing_curve",{clipId:clip.id,channel:target,frame:0,easing:{x1:0.25,y1:0,x2:0.75,y2:1}});
    await call("generate_procedural_cycle",{clipId:clip.id,cycle:"walk",boneId:"agent-thigh",amplitude:12});
    await call("bake_ik_to_keyframes",{clipId:clip.id,constraintId:"agent-foot",startFrame:0,endFrame:23});
    const render = await call("trigger_lottie_export",{clipId:clip.id,endFrame:3});
    expect(["queued","running","ready"]).toContain(render.status);
    await page.getByLabel("Animation clip").selectOption({label:"Agent walk"});
    await expect(page.getByRole("button",{name:"Agent thigh rotation keyframe 1",exact:true})).toBeVisible();
    const unauthorized = await client.callTool({
      name:"insert_keyframe",arguments:{clipId:separate.id,channel:target,frame:0,value:20},
    });
    expect(unauthorized.isError).toBe(true);

    await stdio.connect(new StdioClientTransport({
      command:process.execPath,args:[resolve("scripts/kinetix-mcp.mjs")],
      env:{KINETIX_MCP_URL:endpoint.href,KINETIX_MCP_TOKEN:authorization.slice("Bearer ".length)},
    }));
    expect((await stdio.listTools()).tools.map(tool=>tool.name).sort()).toEqual(scopedTools);
    const hierarchy = await stdio.readResource({uri:"kinetix://rig-hierarchy"});
    expect(hierarchy.contents.some(item=>"text" in item && item.text.includes("agent-shin"))).toBe(true);

    await page.getByRole("button",{name:"MCP",exact:true}).click();
    page.once("dialog",dialog=>dialog.accept());
    await setup.getByRole("button",{name:"Revoke",exact:true}).click();
    await expect(setup.getByRole("list",{name:"Rig credentials"})).toHaveCount(0);
    expect((await page.request.post(endpoint.href,{headers:{Authorization:authorization},data:{jsonrpc:"2.0",id:1,method:"tools/list",params:{}}})).status()).toBe(401);
  } finally {
    await stdio.close().catch(()=>{});
    await client.close().catch(()=>{});
    for (const path of rigs) await page.request.delete(path);
  }
});
