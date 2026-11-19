import { Hono } from "hono";
import { stream } from "hono/streaming";
import { validator } from "hono/validator";
import { z } from "zod";
import type { Library } from "../../db/library";
import { exportRequested, inngest } from "../../jobs/client";
import type { IdentityEnv } from "../api";
import { tracksSchema } from "../rig/animation";
import { readRigState } from "../rig/model";
import { studyFor } from "../studies";
import { exportFormatSchema, exportSnapshotSchema, formats, supportedExport } from "./frames";

export const exportRequest = z.strictObject({
  id: z.uuid(), format: exportFormatSchema, clipId: z.uuid().optional(),
  startFrame: z.int().min(0).optional(), endFrame: z.int().min(0).optional(),
});
const missing = {error:"not_found"} as const;

export function exportApi(repository: () => Library) {
  return new Hono<IdentityEnv>()
    .get("/:id/exports",async c => {
      return c.json(await repository().exports.list(c.get("userId")!,c.req.param("id")));
    })
    .post("/:id/exports",validator("json",(value,c) => {
      const result = exportRequest.safeParse(value);
      return result.success ? result.data : c.json({error:"invalid_export"},400);
    }),async c => {
      const owner = c.get("userId")!;
      const rigId = c.req.param("id");
      const job = c.req.valid("json");
      const queue = repository().exports;
      const input = await queue.inputs(owner,rigId,job.clipId);
      if (!input) return c.json(missing,404);
      const state = readRigState(input.state);
      const study = studyFor(state.study);
      const frameCount = input.clip?.frameCount ?? study.frames;
      const snapshot = exportSnapshotSchema.safeParse({
        name: input.clip?.name ?? input.name, rig:state, tracks:tracksSchema.parse(input.clip?.tracks ?? []),
        fps:input.clip?.fps ?? 24, frameCount, startFrame:job.startFrame ?? 0, endFrame:job.endFrame ?? frameCount-1,
      });
      if (!snapshot.success || !supportedExport(job.format,snapshot.data)) return c.json({error:"unsupported_range"},400);
      const queued = await queue.enqueue(owner,rigId,job.id,job.format,snapshot.data);
      if (!queued) return c.json({error:"export_conflict"},409);
      if (queued.status === "queued" && (process.env.INNGEST_EVENT_KEY || process.env.INNGEST_DEV === "1")) {
        try {
          await inngest.send({id:job.id,name:exportRequested,data:{jobId:job.id}});
        } catch (error) {
          console.error("Export event delivery failed. The schedule can pick up the stored job.",error);
        }
      }
      return c.json(queued,202);
    })
    .get("/:id/exports/:job/download",async c => {
      const id = c.req.param("job");
      if (!z.uuid().safeParse(id).success) return c.json(missing,404);
      const job = await repository().exports.download(c.get("userId")!,c.req.param("id"),id);
      if (!job?.artifact) return c.json(missing,404);
      const { mime, extension } = formats[job.format];
      const file = Buffer.from(job.artifact,"base64");
      c.header("Content-Type",mime);
      c.header("Content-Disposition",`attachment; filename="kinetix-${id}.${extension}"`);
      c.header("X-Content-Type-Options","nosniff");
      return stream(c,async body => {
        for (let offset = 0; offset < file.length; offset += 128 * 1024) {
          if (body.aborted) return;
          await body.write(file.subarray(offset,offset + 128 * 1024));
        }
      });
    });
}
