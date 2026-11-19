import { z } from "zod";
import type { ExportQueue } from "../../db/exports";
import { exportRequested, inngest } from "../../jobs/client";
import { tracksSchema } from "../rig/animation";
import { readRigState } from "../rig/model";
import { studyFor } from "../studies";
import { exportFormatSchema, exportSnapshotSchema, supportedExport } from "./frames";

export const exportRequest = z.strictObject({
  id:z.uuid(),format:exportFormatSchema,clipId:z.uuid().optional(),
  startFrame:z.int().min(0).optional(),endFrame:z.int().min(0).optional(),
});

export async function queueExport(queue:ExportQueue, owner:string, rigId:string, job:z.infer<typeof exportRequest>) {
  const input = await queue.inputs(owner,rigId,job.clipId);
  if (!input) return {error:"not_found",status:404} as const;
  const state = readRigState(input.state);
  const study = studyFor(state.study);
  const frameCount = input.clip?.frameCount ?? study.frames;
  const snapshot = exportSnapshotSchema.safeParse({
    name:input.clip?.name ?? input.name,rig:state,tracks:tracksSchema.parse(input.clip?.tracks ?? []),
    fps:input.clip?.fps ?? 24,frameCount,startFrame:job.startFrame ?? 0,endFrame:job.endFrame ?? frameCount-1,
  });
  if (!snapshot.success || !supportedExport(job.format,snapshot.data)) return {error:"unsupported_range",status:400} as const;
  const queued = await queue.enqueue(owner,rigId,job.id,job.format,snapshot.data);
  if (!queued) return {error:"export_conflict",status:409} as const;
  if (queued.status === "queued" && (process.env.INNGEST_EVENT_KEY || process.env.INNGEST_DEV === "1")) {
    try {
      await inngest.send({id:job.id,name:exportRequested,data:{jobId:job.id}});
    } catch {
      console.error("Export event delivery failed. The schedule can pick up the stored job.");
    }
  }
  return {job:queued,status:202} as const;
}
