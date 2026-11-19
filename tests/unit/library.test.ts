import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { createApi } from "../../lib/api";
import { Library } from "../../db/library";
import { processThumbnails } from "../../jobs/thumbnails";

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
