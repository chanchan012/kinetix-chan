import { Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import type { Library } from "../../db/library";
import type { IdentityEnv } from "../api";

const createToken = z.strictObject({label:z.string().trim().min(1).max(80),allowArchiveReopen:z.boolean().default(false)});
const missing = {error:"not_found"} as const;

export function credentialApi(repository:()=>Library) {
  return new Hono<IdentityEnv>()
    .get("/:id/mcp-credentials",async c => {
      const keys = await repository().tokens.list(c.get("userId")!,c.req.param("id"));
      return keys ? c.json(keys,200) : c.json(missing,404);
    })
    .post("/:id/mcp-credentials",validator("json",(value,c) => {
      const checked = createToken.safeParse(value);
      return checked.success ? checked.data : c.json({error:"invalid_label"},400);
    }),async c => {
      const {label,allowArchiveReopen}=c.req.valid("json");
      const credential = await repository().tokens.create(c.get("userId")!,c.req.param("id"),label,allowArchiveReopen);
      return credential ? c.json(credential,201) : c.json(missing,404);
    })
    .delete("/:id/mcp-credentials/:credential",async c => {
      const id = c.req.param("credential");
      if (!z.uuid().safeParse(id).success) return c.json(missing,404);
      const removed = await repository().tokens.revoke(c.get("userId")!,c.req.param("id"),id);
      return removed ? c.body(null,204) : c.json(missing,404);
    });
}
