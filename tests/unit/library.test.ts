import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { createApi } from "../../lib/api";
import { Library } from "../../db/library";
import { processThumbnails } from "../../jobs/thumbnails";
import { createRigState } from "../../lib/rig/model";
import { sampleRig, setKey, tracksSchema } from "../../lib/rig/animation";
import { processExport } from "../../jobs/exports";
import { RigAgent } from "../../lib/mcp/actions";
import type { RigCommand } from "../../lib/rig/commands";
import { evaluateRig } from "../../lib/rig/kinematics";
import { readRigState } from "../../lib/rig/model";
import { strFromU8, unzipSync } from "fflate";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { spriteBundleRequest } from "../../lib/export/sprite-bundle-options";
import { planSvgImport } from "../../lib/rig/svg-import";
import { editRig } from "../../lib/rig/commands";
import { exportedSequenceFixture,sequenceArtboard } from "../fixtures/png-sequence";
import { sequenceImportInput } from "../../lib/import/sequence-options";
import { exportedAtlasFixture } from "../fixtures/sprite-atlas";

const pg = new PGlite();
const library = new Library(drizzle(pg));
const api = createApi({
  identify: async (c,next) => { c.set("userId", c.req.header("test-owner") ?? null); await next(); },
  clientKey: () => "local", limit: async () => ({success:true,reset:0})
}, () => library);

function call(owner: string, method: string, path = "", body?: object) {
  return api.request("/api/rigs" + path, { method, headers: { ...(owner ? {"test-owner":owner} : {}), "content-type":"application/json" }, body:body ? JSON.stringify(body) : undefined });
}
beforeAll(async () => {
  for (const file of readdirSync("drizzle").filter(f => f.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync("drizzle/" + file,"utf8"));
  }
},30000);
afterAll(() => pg.close());
describe("saved library", () => {
  it("commits all sprite bundle clips in one revision and rejects a stale apply",async()=>{
    const owner="atlas-owner";
    const rig=await library.create(owner,"Atlas fixture",sequenceArtboard);
    const path=`/${rig.id}/imports/sprite-bundle`;
    const input={revision:rig.revision,name:"Lantern",archive:Buffer.from(await exportedAtlasFixture()).toString("base64")};
    try {
      expect((await call("other","POST",path,input)).status).toBe(404);
      const preview=await call(owner,"POST",path,{...input,preflight:true});
      expect(preview.status).toBe(200);
      const {receipt}=await preview.json();
      expect(receipt).toMatchObject({applied:false,clips:[{direction:"east",frameCount:107},{direction:"west",frameCount:6}]});
      expect(await library.listClipAnimation(owner,rig.id)).toEqual([]);
      const apply=()=>call(owner,"POST",path,{...input,importId:receipt.importId});
      const attempts=await Promise.all([apply(),apply()]);
      expect(attempts.map(response=>response.status).sort()).toEqual([201,409]);
      const ids=receipt.clips.map((clip:{id:string})=>clip.id).sort();
      expect((await library.listClipAnimation(owner,rig.id)).map(clip=>clip.id).sort()).toEqual(ids);
      const saved=(await library.get(owner,rig.id))!;
      expect(saved.revision).toBe(rig.revision+1);
      expect(readRigState(saved.state).spriteSources?.map(clip=>clip.clipId).sort()).toEqual(ids);
    } finally {
      await library.remove(owner,rig.id);
    }
  });
  it("commits imported drawings and clips together under the same revision guard for Studio and MCP",async()=>{
    const studio=await library.create("sequence-owner","Studio sequence",sequenceArtboard);
    const assisted=await library.create("sequence-owner","MCP sequence",sequenceArtboard);
    const input={name:"Firefly",archive:exportedSequenceFixture().toString("base64"),revision:studio.revision,
      importId:"c41f11c5-f95f-4274-95a9-977090da3331"};
    const path=`/${studio.id}/imports/png-sequence`;
    try {
      expect((await call("other","POST",path,input)).status).toBe(404);
      const preview=await call("sequence-owner","POST",path,{...input,preflight:true});
      expect(preview.status).toBe(200);
      expect((await preview.json()).receipt).toMatchObject({applied:false,frameCount:7,fps:18,blankFrames:1});
      expect(await library.listClipAnimation("sequence-owner",studio.id)).toEqual([]);

      const [first,second]=await Promise.all([
        call("sequence-owner","POST",path,input),call("sequence-owner","POST",path,input),
      ]);
      expect([first.status,second.status].sort()).toEqual([201,409]);
      const drawing=readRigState((await library.get("sequence-owner",studio.id))!.state).drawings!.layers[0];
      expect(drawing.tracks[0].clipId).toBe(input.importId);
      const clips=await library.listClipAnimation("sequence-owner",studio.id);
      expect(clips).toMatchObject([{id:input.importId,fps:18,frameCount:7}]);

      const stored=readRigState(assisted.state);
      await expect(library.saveRasterImport("sequence-owner",assisted.id,0,stored,[
        {id:crypto.randomUUID(),name:"Valid",fps:18,frameCount:7},
        {id:crypto.randomUUID(),name:"Rejected",fps:0,frameCount:7},
      ])).rejects.toThrow();
      expect((await library.get("sequence-owner",assisted.id))?.revision).toBe(0);
      expect(await library.listClipAnimation("sequence-owner",assisted.id)).toEqual([]);
      const token=await library.tokens.create("sequence-owner",assisted.id,"Sequence agent");
      const agent=new RigAgent(library,(await library.tokens.verify(token!.token))!);
      const prepared=await agent.importPngSequence(sequenceImportInput.parse({...input,importId:undefined,preflight:true}));
      const applied=await agent.importPngSequence(sequenceImportInput.parse({...input,importId:prepared.importId}));
      expect(applied).toMatchObject({revision:1,applied:true,drawingId:prepared.drawingId,celCount:3,blankFrames:1});
      const agentDrawing=readRigState((await library.get("sequence-owner",assisted.id))!.state).drawings!.layers[0];
      expect(agentDrawing.cels.map(cel=>cel.runs)).toEqual(drawing.cels.map(cel=>cel.runs));
    } finally {
      await library.remove("sequence-owner",studio.id);
      await library.remove("sequence-owner",assisted.id);
    }
  });
  it("preflights, applies and pins the same SVG import over scoped MCP and the studio command path",async ()=>{
    const rig=await library.create("illustrator","SVG fixture",{name:"Artwork",width:120,height:96,background:null});
    const credential=await library.tokens.create("illustrator",rig.id,"SVG agent");
    try {
      const agent=new RigAgent(library,(await library.tokens.verify(credential!.token))!);
      const svg=readFileSync("tests/fixtures/layered-artwork.svg","utf8");
      const importId="38862090-7b23-45b8-9e01-0b2b302b08f4";
      const args={revision:rig.revision,svg,importId,placement:"original" as const};
      const preview=await agent.importSvg({...args,preflight:true});
      expect(preview).toMatchObject({ready:true,applied:false,partCount:4,diagnostics:[{element:"text #Caption"}]});
      expect((await agent.hierarchy()).parts).toEqual([]);
      const applied=await agent.importSvg({...args,preflight:false});
      expect(applied).toMatchObject({applied:true,groupId:preview.groupId,revision:rig.revision+1});
      const [studio]=editRig(readRigState(rig.state),planSvgImport(svg,{importId}).commands);
      const saved=await library.get("illustrator",rig.id);
      expect(saved!.state).toEqual(JSON.parse(JSON.stringify(studio)));
      await expect(agent.importSvg({...args,preflight:false})).rejects.toThrow("document has changed");
      expect((await agent.hierarchy()).revision).toBe(applied.revision);
    } finally {
      await library.remove("illustrator",rig.id);
    }
  });
  it("edits and reads scoped cels through MCP and renders the queued revision",async ()=>{
    const rig=await library.create("artist","Raster fixture",{name:"Flame",width:48,height:48,background:null});
    const path="/"+rig.id;
    const credential=await library.tokens.create("artist",rig.id,"Cel agent");
    try {
      const agent=new RigAgent(library,(await library.tokens.verify(credential!.token))!);
      const clip=await agent.createClip({name:"Flicker",fps:12,frameCount:6});
      const clipId=clip.id as string;
      const drawingId="flame";
      const celId="lit";
      const edit=await agent.editDocument({revision:rig.revision,commands:[
        {type:"drawing.create",drawing:{id:drawingId,name:"Flame",width:48,height:48,
          storage:{mode:"indexed",colors:["#ff9500"]}}},
        {type:"cel.create",drawingId,id:celId},
        {type:"cel.edit",drawingId,id:celId,operation:{
          kind:"stroke",tool:"pencil",ink:255,size:1,opacity:1,stabilization:0,symmetry:"none",
          points:[{x:16.5,y:14.5,pressure:1},{x:18.5,y:14.5,pressure:1}],
        }},
        {type:"exposure.set",drawingId,clipId,key:{frame:0,celId}},
        {type:"exposure.set",drawingId,clipId,key:{frame:4,celId:null}},
      ]});
      await expect(agent.readDrawingCel({drawingId,celId,revision:edit.revision,limit:1,offset:0}))
        .resolves.toMatchObject({runs:[[14,16,3,255]],nextOffset:null});
      await expect(agent.editDocument({revision:edit.revision,commands:[
        {type:"exposure.set",drawingId,clipId,key:{frame:6,celId}},
      ]})).rejects.toThrow("outside the clip");
      const id="41d1e947-b067-45c0-919b-84cdac5d43c3";
      const request={id,format:"png-sequence",clipId,startFrame:2,endFrame:4,scale:3};
      expect((await call("artist","POST",path+"/exports",{...request,format:"lottie"})).status).toBe(400);
      expect((await call("artist","POST",path+"/exports",request)).status).toBe(202);
      await agent.editDocument({revision:edit.revision,commands:[{type:"drawing.palette",id:drawingId,colors:["#ff0000"]}]});
      expect(await processExport(library.exports,id)).toEqual({id,status:"ready"});
      const pngs=unzipSync(Buffer.from(await (await call("artist","GET",path+"/exports/"+id+"/download")).arrayBuffer()));
      expect(JSON.parse(strFromU8(pngs["sequence.json"]))).toMatchObject({width:144,height:144,startFrame:3,endFrame:5});
      for (const [name,rgba] of [["00003",[255,149,0,255]],["00005",[0,0,0,0]]] as const) {
        const image=await loadImage(pngs["frames/"+name+".png"]);
        const canvas=createCanvas(image.width,image.height).getContext("2d");
        canvas.drawImage(image,0,0);
        expect(Array.from(canvas.getImageData(48,42,1,1).data)).toEqual(rgba);
      }
    } finally {
      await library.remove("artist",rig.id);
    }
  });

  it("edits a blank design through scoped MCP commands, protects its revision and serves its saved artboard", async () => {
    const created = await call("owner","POST","",{name:"Portrait",artboard:{name:"Portrait",width:240,height:360,background:null}});
    expect(created.status).toBe(201);
    const rig = await created.json();
    const path = "/" + rig.id;
    const issued = await call("owner","POST",path+"/mcp-credentials",{label:"Design agent"});
    const {token} = await issued.json();
    const agent = new RigAgent(library,(await library.tokens.verify(token))!);
    expect(await agent.viewportBounds()).toMatchObject({width:240,height:360,artboard:{background:null}});
    const commands: RigCommand[] = [
      {type:"artboard.update",artboard:{name:"Poster",width:256,height:384,background:null}},
      {type:"part.create",part:{
        id:"face",name:"Face",offset:{x:0,y:0},parentId:null,closed:true,fill:"#c34728",
        knots:[{point:{x:32,y:64}},{point:{x:128,y:64}},{point:{x:80,y:180}}],
      }},
      {type:"part.splitEdge",id:"face",edge:0},
    ];
    await agent.editDocument({revision:rig.revision,commands});
    await expect(agent.editDocument({revision:rig.revision,commands})).rejects.toThrow("changed");
    expect(await agent.hierarchy()).toMatchObject({parts:[{id:"face",knots:[{},{point:{x:80,y:64}},{},{}]}]});
    const clip = await agent.createClip({name:"Eye movement",fps:12,frameCount:5});
    const channel = {kind:"part",id:"face",property:"y"} as const;
    await agent.insertKey({clipId:clip.id as string,channel,frame:0,value:0});
    await agent.insertKey({clipId:clip.id as string,channel,frame:4,value:24});
    const {clips} = await agent.timelineSummary();
    const state = readRigState((await library.get("owner",rig.id))!.state);
    expect(sampleRig(state,clips[0].tracks,2).parts[0].offset.y).toBe(12);
    const parameters = {
      clipId:clip.id as string,revision:rig.revision+1,trackRevision:2,startFrame:0,endFrame:4,
      pivot:{x:38,y:160},loop:true,filter:"nearest" as const,preflight:true,
    };
    const preflight = await call("owner","POST",path+"/sprite-package",parameters);
    expect(preflight.status).toBe(200);
    expect(await preflight.json()).toMatchObject({version:1,frames:[
      {sourceFrame:0,pivot:{x:38,y:160}}, {sourceFrame:1}, {sourceFrame:2}, {sourceFrame:3}, {sourceFrame:4},
    ]});
    expect((await call("other","POST",path+"/sprite-package",parameters)).status).toBe(404);
    expect((await call("owner","POST",path+"/sprite-package",{...parameters,trackRevision:1})).status).toBe(409);
    const packageBytes = await call("owner","POST",path+"/sprite-package",{...parameters,preflight:false});
    expect(packageBytes.headers.get("content-type")).toBe("application/zip");
    const agentPackage = await agent.exportSpritePackage({...parameters,preflight:false});
    expect(Buffer.from(await packageBytes.arrayBuffer()).toString("base64")).toBe(agentPackage.base64);
    const bundleRequest=spriteBundleRequest.parse({revision:rig.revision+1,layout:"packed",clips:[{
      id:clip.id,trackRevision:2,startFrame:0,endFrame:4,direction:"east",frames:[{frame:1,durationTicks:4}],
    }]});
    expect((await call("other","POST",path+"/sprite-bundle",bundleRequest)).status).toBe(404);
    expect((await call("owner","POST",path+"/sprite-bundle",{...bundleRequest,clips:[{
      ...bundleRequest.clips[0],trackRevision:1,
    }]})).status).toBe(409);
    const bundle=await call("owner","POST",path+"/sprite-bundle",bundleRequest);
    expect(bundle.headers.get("content-type")).toBe("application/zip");
    expect(Buffer.from(await bundle.arrayBuffer()).toString("base64")).toBe(
      (await agent.exportSpriteBundle(bundleRequest)).base64,
    );
    expect((await call("other","GET",path+"/artboard.png")).status).toBe(404);
    const exported = await call("owner","GET",path+"/artboard.png");
    expect(exported.headers.get("content-type")).toBe("image/png");
    const png = Buffer.from(await exported.arrayBuffer());
    expect([png.readUInt32BE(16),png.readUInt32BE(20)]).toEqual([256,384]);
    await library.remove("owner",rig.id);
  });

  it("issues owner-only, revocable rig credentials and bakes a matching IK pose", async () => {
    const rig = await library.create("owner","MCP fixture","fox");
    const path = "/" + rig.id + "/mcp-credentials";
    expect((await call("other","POST",path,{label:"Agent"})).status).toBe(404);
    const issued = await call("owner","POST",path,{label:"Agent"});
    expect(issued.status).toBe(201);
    const {id,token} = await issued.json();
    const publicRows = await (await call("owner","GET",path)).json();
    expect(Object.keys(publicRows[0]).sort()).toEqual(["createdAt","expiresAt","id","label"]);
    const credential = await library.tokens.verify(token);
    expect(credential?.rigId).toEqual(rig.id);
    const agent = new RigAgent(library,credential!);
    await agent.attachIK({constraint:{id:"foot",upperId:"upper",lowerId:"lower",target:{x:348,y:194},bend:1}});
    const clip = await agent.createClip({name:"Bake",fps:24,frameCount:12});
    const clipId = clip.id as string;
    await agent.generateCycle({clipId,cycle:"walk",boneId:"upper",amplitude:12});
    const before = await library.getClipAnimation("owner",rig.id,clipId);
    const authored = readRigState((await library.get("owner",rig.id))!.state);
    const target = evaluateRig(sampleRig(authored,tracksSchema.parse(before!.tracks),5)).get("lower")!.tip;
    await agent.bakeIK({clipId,constraintId:"foot",startFrame:3,endFrame:9});
    const baked = tracksSchema.parse((await library.getClipAnimation("owner",rig.id,clipId))!.tracks);
    const pose = sampleRig(authored,baked,5);
    expect(pose.constraints[0].enabled).toBe(false);
    expect(sampleRig(authored,baked,2).constraints[0].enabled).toBe(true);
    expect(evaluateRig(pose).get("lower")!.tip.x).toBeCloseTo(target.x);
    expect(evaluateRig(pose).get("lower")!.tip.y).toBeCloseTo(target.y);
    expect((await call("owner","DELETE",path+"/"+id)).status).toBe(204);
    expect(await library.tokens.verify(token)).toBeUndefined();
    await library.remove("owner",rig.id);
  });
  it("allows an authorized editor to modify the rig and its clips until access is revoked", async () => {
    const rig = await library.create("owner","Shared","fox");
    const path = "/"+rig.id;
    expect((await call("editor","GET",path+"/state")).status).toBe(404);
    await library.addCollaborator("owner",rig.id,"editor","editor@example.com");
    expect((await (await call("editor","GET")).json())).toEqual([expect.objectContaining({id:rig.id,owned:false})]);
    expect((await call("editor","POST",path+"/clips",{name:"Walk",fps:24,frameCount:36})).status).toBe(201);
    expect((await call("editor","PATCH",path+"/state",{revision:0,state:createRigState("fox")})).status).toBe(200);
    expect((await call("editor","GET",path+"/collaborators")).status).toBe(404);
    expect((await call("editor","DELETE",path)).status).toBe(404);
    expect((await call("owner","DELETE",path+"/collaborators/editor")).status).toBe(204);
    expect((await call("editor","PATCH",path+"/state",{revision:1,state:createRigState("fox")})).status).toBe(404);
    expect((await call("owner","DELETE",path)).status).toBe(204);
  });
  it("stores an immutable export snapshot and hands completed bytes only to the owner", async () => {
    const rig = await (await call("artist","POST","",{name:"Export fixture",study:"fox"})).json();
    const id = "21dfd810-ec66-4c8e-8122-7140bbcaf6a2";
    const path = `/${rig.id}/exports`;
    const request = {id,format:"lottie",startFrame:2,endFrame:5};
    expect((await call("other","POST",path,request)).status).toBe(404);
    expect((await call("artist","POST",path,{...request,endFrame:50})).status).toBe(400);
    expect((await call("artist","POST",path,request)).status).toBe(202);
    expect((await call("artist","POST",path,request)).status).toBe(202);
    expect((await (await call("artist","GET",path)).json())).toHaveLength(1);
    expect(await (await call("other","GET",path)).json()).toEqual([]);
    expect((await call("artist","GET",path+"/"+id+"/download")).status).toBe(404);
    expect((await call("artist","PATCH",`/${rig.id}`,{name:"Renamed later"})).status).toBe(200);
    expect(await processExport(library.exports,id)).toEqual({id,status:"ready"});
    expect(await processExport(library.exports,id)).toBeNull();
    const download = path+"/"+id+"/download";
    expect((await call("other","GET",download)).status).toBe(404);
    const file = await call("artist","GET",download);
    expect(file.headers.get("content-type")).toBe("application/json");
    expect(file.headers.get("content-disposition")).toContain(".json");
    expect(await file.json()).toMatchObject({nm:"Export fixture",op:4});
    expect((await call("artist","DELETE",`/${rig.id}`)).status).toBe(204);
  });

  it("recovers an expired render lease and rejects output from the expired worker", async () => {
    const rig = await library.create("lease","Lease","fish");
    const id = "102f75b4-29c0-4172-8daa-c6a054c720bb";
    await library.exports.enqueue("lease",rig.id,id,"spritesheet",{
      rig:createRigState("fish"),name:"Lease",fps:24,frameCount:48,startFrame:0,endFrame:5,tracks:[],
    });
    const now = new Date();
    const first = await library.exports.claim(id,now);
    expect(first?.leaseId).toBeTruthy();
    expect(await library.exports.claim(id,now)).toBeUndefined();
    const next = await library.exports.claim(id,new Date(now.getTime()+181_000));
    expect(next?.leaseId).not.toBe(first?.leaseId);
    expect(await library.exports.finish(id,first!.leaseId!,Buffer.from("stale"))).toEqual([]);
    expect(await library.exports.finish(id,next!.leaseId!,Buffer.from("current"))).toEqual([{id,status:"ready"}]);
    await library.remove("lease",rig.id);
  });
  it("persists typed keyframes, rejects stale and out-of-range writes, and clips keys on duration changes", async () => {
    const rig = await (await call("animator","POST","",{ name:"Animation",study:"fox" })).json();
    const clipTiming = { name:"Walk", fps:24, frameCount:24 };
    const clip = await (await call("animator","POST",`/${rig.id}/clips`,clipTiming)).json();
    const path = `/${rig.id}/clips/${clip.id}`;
    const channel = { kind:"bone", id:"root", property:"rotation" } as const;
    const tracks = setKey(setKey([],channel,3,0),channel,18,0.4);
    expect((await call("other","GET",path+"/tracks")).status).toBe(404);
    expect((await call("animator","PATCH",path+"/tracks",{trackRevision:0,tracks:setKey(tracks,channel,24,0)})).status).toBe(400);
    expect((await call("animator","PATCH",path+"/tracks",{trackRevision:0,tracks})).status).toBe(200);
    expect((await call("animator","PATCH",path+"/tracks",{trackRevision:0,tracks})).status).toBe(409);
    expect((await call("animator","PATCH",path,{ ...clipTiming, frameCount:10 })).status).toBe(200);
    const response = await call("animator","GET",path+"/tracks");
    expect(await response.json()).toMatchObject({ trackRevision:2, frameCount:10, tracks:[{keys:[tracks[0].keys[0]]}] });
    expect((await call("animator","DELETE",`/${rig.id}`)).status).toBe(204);
  });
  it("reads legacy rig state and applies exactly one of two competing owner saves", async () => {
    const id = "e88df79a-62d6-4e08-91e8-9dc8ef2b7abc";
    await pg.query("insert into rigs (id,owner_id,name,state) values ($1,$2,$3,$4)", [id,"editor","Legacy",JSON.stringify({study:"heron"})]);
    const path = "/" + id + "/state";
    const state = createRigState("heron");
    expect(await (await call("editor","GET",path)).json()).toMatchObject({ revision:0, state });
    expect((await call("","GET",path)).status).toBe(401);
    expect((await call("other","PATCH",path,{revision:0,state})).status).toBe(404);
    expect((await call("editor","PATCH",path,{revision:0,state:createRigState("fish")})).status).toBe(400);

    state.bones[1].rotation = Math.PI / 3;
    const competing = await Promise.all([
      call("editor","PATCH",path,{revision:0,state}),
      call("editor","PATCH",path,{revision:0,state}),
    ]);
    expect(competing.map(response => response.status).sort()).toEqual([200,409]);
    expect(await (await call("editor","GET",path)).json()).toMatchObject({ revision:1, state });
    expect((await call("editor","DELETE","/"+id)).status).toBe(204);
  });
  it("rejects guest access and malformed data", async () => {
    expect((await call("", "GET")).status).toBe(401);
    expect((await call("a","GET","/invalid")).status).toBe(404);
    expect((await call("a", "POST","",{name:" ",study:"fox"})).status).toBe(400);
  });
  it("scopes rig and clip CRUD to the owner, and renders pending thumbnails once", async () => {
    const created = await call("a","POST","",{name:"Test rig",study:"fox"});
    expect(created.status).toBe(201);
    const {id} = await created.json();
    const path = "/" + id;
    expect(await (await call("b","GET")).json()).toEqual([]);
    expect(await (await call("a","GET")).json()).toEqual([expect.objectContaining({id})]);
    const clip = {name:"Flight",fps:24,frameCount:36};
    const saved = await call("a","POST",path+"/clips",clip);
    expect(saved.status).toBe(201);
    const clipPath = path+"/clips/"+(await saved.json()).id;
    for (const [method,url,body] of [
      ["GET",path],["PATCH",path,{name:"Taken"}],["DELETE",path],["GET",path+"/clips"],
      ["POST",path+"/clips",clip],["PATCH",clipPath,clip],["DELETE",clipPath]
    ] as const) expect((await call("b",method,url,body)).status).toBe(404);
    expect((await call("a","PATCH",path,{name:"Renamed"})).status).toBe(200);
    expect(await processThumbnails(library)).toBe(1);
    expect(await processThumbnails(library)).toBe(0);
    const [thumb] = await (await call("a","GET",path+"/clips")).json();
    expect(thumb.thumbnail).toMatch(/^data:image\/png;base64,iVBOR/);
    expect((await call("a","PATCH",clipPath,{...clip,fps:30})).status).toBe(200);
    expect(await library.saveThumbnail(thumb.id,24,36,"stale")).toHaveLength(0);
    expect(await processThumbnails(library)).toBe(1);
    expect((await call("a","DELETE",clipPath)).status).toBe(204);
    expect((await call("a","DELETE",path)).status).toBe(204);
    expect((await call("a","GET",path)).status).toBe(404);
  });
});
