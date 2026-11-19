import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { createApi } from "../../lib/api";
import { Library } from "../../db/library";
import { processThumbnails } from "../../jobs/thumbnails";
import { createRigState } from "../../lib/rig/model";
import { setKey } from "../../lib/rig/animation";
import { processExport } from "../../jobs/exports";

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
