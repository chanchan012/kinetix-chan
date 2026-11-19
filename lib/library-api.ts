import { Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import type { IdentityEnv } from "./api";
import type { Library } from "../db/library";
import { readRigState, rigStateSchema } from "./rig/model";
import { tracksSchema } from "./rig/animation";
import { exportApi } from "./export/api";
import { realtimeApi } from "./realtime/api";
import type { RoomBus } from "./realtime/bus";
import { credentialApi } from "./mcp/credentials";

const name = z.string().trim().min(1).max(120);
const createRig = z.strictObject({name,study:z.enum(["fox","heron","fish"])});
const renameRig = z.strictObject({name});
const editClip = z.strictObject({name,fps:z.int().min(1).max(120),frameCount:z.int().min(1).max(36000)});
const editRigState = z.strictObject({ revision:z.int().min(0).max(2_147_483_646), state:rigStateSchema });
const editTracks = z.strictObject({ trackRevision:z.int().min(0).max(2_147_483_646), tracks:tracksSchema });
function body<T extends z.ZodType>(schema:T) {
  return validator("json",(value,c) => {
    const result = schema.safeParse(value);
    return result.success ? result.data as z.output<T> : c.json({error:"invalid_input"},400);
  });
}
const missing = {error:"not_found"} as const;
export function libraryApi(repository:()=>Library,rooms?:()=>RoomBus) {
  return new Hono<IdentityEnv>()
    .use("*",async(c,next) => {
      if (!c.get("userId")) return c.json({error:"authentication_required"},401);
      await next();
    })
    .use("/:id/*",async(c,next) => {
      if (!z.uuid().safeParse(c.req.param("id")).success) return c.json(missing,404);
      await next();
    })
    .use("/:id/clips/:clip",async(c,next) => {
      if (!z.uuid().safeParse(c.req.param("clip")).success) return c.json(missing,404);
      await next();
    })
    .get("/",async c => c.json(await repository().list(c.get("userId")!)))
    .post("/",body(createRig),async c => {
      const {name,study} = c.req.valid("json");
      return c.json(await repository().create(c.get("userId")!,name,study),201);
    })
    .get("/:id",async c => {
      const row = await repository().open(c.get("userId")!,c.req.param("id"));
      return row ? c.json(row) : c.json(missing,404);
    })
    .patch("/:id",body(renameRig),async c => {
      const row = await repository().rename(c.get("userId")!,c.req.param("id"),c.req.valid("json").name);
      return row ? c.json(row) : c.json(missing,404);
    })
    .delete("/:id",async c => await repository().remove(c.get("userId")!,c.req.param("id")) ? c.body(null,204) : c.json(missing,404))
    .get("/:id/state",async c => {
      const row = await repository().open(c.get("userId")!,c.req.param("id"));
      return row ? c.json({ ...row, state:readRigState(row.state) }) : c.json(missing,404);
    })
    .patch("/:id/state",body(editRigState),async c => {
      const owner = c.get("userId")!;
      const id = c.req.param("id");
      const {revision,state} = c.req.valid("json");
      const library = repository();
      const saved = await library.saveRigState(owner,id,revision,state);
      if (saved) {
        if (rooms) {
          const client = z.uuid().safeParse(c.req.header("x-kinetix-client"));
          try {
            await rooms().changed(id,{type:"revision",revision:saved.revision,userId:owner,kind:"human",clientId:client.data},state);
          } catch {
            // The committed revision is still recovered from Neon on stream reconnect.
          }
        }
        return c.json({ ...saved, state });
      }
      const current = await library.open(owner,id);
      if (!current) return c.json(missing,404);
      if (current.revision !== revision) return c.json({error:"revision_conflict",revision:current.revision},409);
      return c.json({error:"study_mismatch"},400);
    })
    .get("/:id/clips",async c => {
      const rows = await repository().listClips(c.get("userId")!,c.req.param("id"));
      return rows ? c.json(rows) : c.json(missing,404);
    })
    .get("/:id/animation",async c => {
      const library = repository();
      const user = c.get("userId")!;
      const id = c.req.param("id");
      if (await library.rigRevision(user,id) === undefined) return c.json(missing,404);
      return c.json((await library.listClipAnimation(user,id)).map(clip=>({...clip,tracks:tracksSchema.parse(clip.tracks)})));
    })
    .get("/:id/clips/:clip/tracks",async c => {
      if (!z.uuid().safeParse(c.req.param("clip")).success) return c.json(missing,404);
      const row = await repository().getClipAnimation(c.get("userId")!,c.req.param("id"),c.req.param("clip"));
      return row ? c.json({ ...row, tracks:tracksSchema.parse(row.tracks) }) : c.json(missing,404);
    })
    .patch("/:id/clips/:clip/tracks",body(editTracks),async c => {
      const owner = c.get("userId")!;
      const id = c.req.param("id");
      const clipId = c.req.param("clip");
      if (!z.uuid().safeParse(clipId).success) return c.json(missing,404);
      const {trackRevision,tracks} = c.req.valid("json");
      const library = repository();
      const current = await library.getClipAnimation(owner,id,clipId);
      if (!current) return c.json(missing,404);
      if (current.trackRevision !== trackRevision) return c.json({error:"track_conflict"},409);
      if (tracks.some(track => track.keys.at(-1)!.frame >= current.frameCount)) return c.json({error:"frame_out_of_range"},400);
      const saved = await library.saveClipTracks(owner,id,clipId,trackRevision,tracks);
      if (saved && rooms) {
        try { await rooms().timeline(id,clipId); } catch {}
      }
      return saved ? c.json({ ...saved, tracks }) : c.json({error:"track_conflict"},409);
    })
    .post("/:id/clips",body(editClip),async c => {
      const row = await repository().addClip(c.get("userId")!,c.req.param("id"),c.req.valid("json"));
      if (row && typeof row.id==="string" && rooms) {
        try { await rooms().timeline(c.req.param("id"),row.id); } catch {}
      }
      return row ? c.json(row,201) : c.json(missing,404);
    })
    .patch("/:id/clips/:clip",body(editClip),async c => {
      const row = await repository().editClip(c.get("userId")!,c.req.param("id"),c.req.param("clip"),c.req.valid("json"));
      if (row && rooms) {
        try { await rooms().timeline(c.req.param("id"),row.id); } catch {}
      }
      return row ? c.json(row) : c.json(missing,404);
    })
    .delete("/:id/clips/:clip",async c => {
      const row = await repository().removeClip(c.get("userId")!,c.req.param("id"),c.req.param("clip"));
      if (!row) return c.json(missing,404);
      if (rooms) {
        try { await rooms().timeline(c.req.param("id"),row.id); } catch {}
      }
      return c.body(null,204);
    })
    .route("/",exportApi(repository))
    .route("/",realtimeApi(repository,rooms))
    .route("/",credentialApi(repository));
}
