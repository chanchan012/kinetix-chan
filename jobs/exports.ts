import { compileLottie } from "../lib/export/lottie";
import { exportSnapshotSchema, supportedExport } from "../lib/export/frames";
import { renderPngSequence, renderSpritesheet, renderVideo } from "../lib/export/raster";
import type { ExportQueue } from "../db/exports";

export async function processExport(queue: ExportQueue, id?: string) {
  const job = await queue.claim(id);
  if (!job?.leaseId) return null;
  let artifact: Buffer | null = null;
  try {
    const snapshot = exportSnapshotSchema.parse(job.snapshot);
    if (!supportedExport(job.format,snapshot)) throw new Error("Export exceeds the supported range.");
    switch (job.format) {
      case "lottie": artifact = Buffer.from(JSON.stringify(compileLottie(snapshot))); break;
      case "spritesheet": artifact = renderSpritesheet(snapshot); break;
      case "png-sequence": artifact = renderPngSequence(snapshot); break;
      case "mp4":
      case "webm": artifact = await renderVideo(snapshot,job.format); break;
    }
    if (artifact.length > 16 * 1024 * 1024) throw new Error("Export exceeds the artifact size limit.");
  } catch (error) {
    console.error("Animation export failed for job",job.id,error);
    artifact = null;
  }
  return (await queue.finish(job.id,job.leaseId,artifact))[0] ?? null;
}
