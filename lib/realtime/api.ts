import { createClerkClient } from "@clerk/backend";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { validator } from "hono/validator";
import { z } from "zod";
import type { Library } from "../../db/library";
import type { IdentityEnv } from "../api";
import type { RoomBus } from "./bus";
import { presenceInput } from "./protocol";

const missing = {error:"not_found"} as const;
const inviteInput = z.strictObject({email:z.email().max(254)});
type Lookup = (email: string) => Promise<string | undefined>;

export async function findClerkUser(email: string) {
  const users = await createClerkClient({secretKey:process.env.CLERK_SECRET_KEY}).users.getUserList({emailAddress:[email],limit:1});
  return users.data.find(user => user.emailAddresses.some(item =>
    item.emailAddress.toLowerCase() === email.toLowerCase() && item.verification?.status === "verified"))?.id;
}

export function realtimeApi(repository: () => Library, roomService?: () => RoomBus, lookup: Lookup = findClerkUser) {
  return new Hono<IdentityEnv>()
    .get("/:id/collaborators",async c => {
      const entries = await repository().collaborators(c.get("userId")!,c.req.param("id"));
      return entries === null ? c.json(missing,404) : c.json(entries);
    })
    .post("/:id/collaborators",validator("json",(value,c) => {
      const result = inviteInput.safeParse(value);
      return result.success ? result.data : c.json({error:"invalid_email"},400);
    }),async c => {
      const owner = c.get("userId")!;
      const id = c.req.param("id");
      const repositoryInstance = repository();
      if (!await repositoryInstance.get(owner,id)) return c.json(missing,404);
      const {email} = c.req.valid("json");
      let user: string | undefined;
      try {
        user = await lookup(email);
      } catch {
        return c.json({error:"identity_unavailable"},503);
      }
      if (!user || user === owner) return c.json({error:"collaborator_unavailable"},404);
      const entry = await repositoryInstance.addCollaborator(owner,id,user,email);
      return entry ? c.json(entry,201) : c.json(missing,404);
    })
    .delete("/:id/collaborators/:user",async c => {
      const id = c.req.param("id");
      const entry = await repository().removeCollaborator(c.get("userId")!,id,c.req.param("user"));
      if (!entry) return c.json(missing,404);
      try { await roomService?.().revoke(id,entry.userId); } catch {}
      return c.body(null,204);
    })
    .post("/:id/presence",validator("json",(value,c) => {
      const result = presenceInput.safeParse(value);
      return result.success ? result.data : c.json({error:"invalid_presence"},400);
    }),async c => {
      const id = c.req.param("id");
      const userId = c.get("userId")!;
      if (await repository().rigRevision(userId,id) === undefined) return c.json(missing,404);
      if (!roomService) return c.json({error:"presence_unavailable"},503);
      try {
        await roomService().mark(id,{ ...c.req.valid("json"),userId,kind:"human",expiresAt:Date.now()+45_000 });
        return c.body(null,204);
      } catch {
        return c.json({error:"presence_unavailable"},503);
      }
    })
    .get("/:id/events",async c => {
      const id = c.req.param("id");
      const userId = c.get("userId")!;
      const library = repository();
      let revision = await library.rigRevision(userId,id);
      if (revision === undefined) return c.json(missing,404);
      if (!roomService) return c.json({error:"presence_unavailable"},503);
      const bus = roomService();
      c.header("Cache-Control","private, no-store, no-transform");
      c.header("X-Accel-Buffering","no");
      return streamSSE(c,async stream => {
        let disposed = false;
        const unsubscribe = bus.subscribe(id,event => {
          if (event.type === "revoke" && event.userId === userId) {
            stream.abort();
            return;
          }
          if (!stream.aborted) void stream.writeSSE({event:event.type,data:JSON.stringify(event)}).catch(() => stream.abort());
        },() => stream.abort());
        const close = () => {
          if (!disposed) unsubscribe();
          disposed = true;
        };
        stream.onAbort(close);
        try {
          const initial = await Promise.all([bus.recent(id),library.listClipVersions(userId,id)]);
          await stream.writeSSE({ event:"snapshot", data:JSON.stringify({revision,presence:initial[0],clips:initial[1]}) });
          for (let tick = 0; tick < 3 && !stream.aborted; tick++) {
            await stream.sleep(12_000);
            if (stream.aborted) return;
            revision = await library.rigRevision(userId,id);
            if (revision === undefined) return;
            const [cached, presence, clips] = await Promise.all([bus.revision(id),bus.recent(id),library.listClipVersions(userId,id)]);
            await stream.writeSSE({ event:"snapshot", data:JSON.stringify({revision:Math.max(revision,cached),presence,clips}) });
          }
        } finally {
          close();
        }
      });
    });
}
