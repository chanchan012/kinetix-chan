import { tracksSchema, sampleRig } from "../rig/animation";
import { evaluateRig } from "../rig/kinematics";
import { artboardFor, rigStateSchema } from "../rig/model";
import { z } from "zod";

export const exportFormats = ["lottie", "spritesheet", "png-sequence", "mp4", "webm"] as const;
export const exportFormatSchema = z.enum(exportFormats);
export type ExportFormat = z.infer<typeof exportFormatSchema>;

export const exportSnapshotSchema = z.strictObject({
  rig: rigStateSchema,
  name: z.string().min(1).max(120),
  fps: z.int().min(1).max(120),
  frameCount: z.int().min(1).max(36_000),
  startFrame: z.int().min(0),
  endFrame: z.int().min(0),
  tracks: tracksSchema,
}).refine(clip => clip.startFrame <= clip.endFrame && clip.endFrame < clip.frameCount);
export type ExportSnapshot = z.infer<typeof exportSnapshotSchema>;
export type ExportFrame = { rig: ExportSnapshot["rig"]; poses: ReturnType<typeof evaluateRig>; phase: number };

export const formats: Record<ExportFormat, { label: string; mime: string; extension: string; frames: number }> = {
  lottie: { label:"Lottie JSON", mime:"application/json", extension:"json", frames:180 },
  spritesheet: { label:"Spritesheet PNG", mime:"image/png", extension:"png", frames:96 },
  "png-sequence": { label:"PNG sequence ZIP", mime:"application/zip", extension:"zip", frames:150 },
  mp4: { label:"MP4 video", mime:"video/mp4", extension:"mp4", frames:240 },
  webm: { label:"WebM video", mime:"video/webm", extension:"webm", frames:240 },
};

export function supportedExport(format: ExportFormat, snapshot: ExportSnapshot): boolean {
  const count = snapshot.endFrame - snapshot.startFrame + 1;
  const shapes = snapshot.rig.parts.reduce((total, part) => total + (part.mesh?.triangles.length ?? 1) +
    (part.facets?.faces.length ?? 0), 64);
  const { width, height } = artboardFor(snapshot.rig);
  if (format !== "lottie" && width * height * count > 64 * 1024 * 1024) return false;
  if (format === "spritesheet") {
    const {columns, rows} = spritesheetGrid(count, width, height);
    if (width * columns > 8192 || height * rows > 8192) return false;
  }
  return count <= formats[format].frames && shapes * count <= (format === "lottie" ? 40_000 : 300_000);
}

export function spritesheetGrid(frames:number, width:number, height:number) {
  const minimum = Math.ceil(frames / Math.floor(8192 / height));
  const maximum = Math.min(frames, Math.floor(8192 / width));
  const columns = Math.min(maximum, Math.max(minimum, Math.ceil(Math.sqrt(frames * height / width))));
  return { columns, rows: Math.ceil(frames / columns) };
}

export function* sampleExportFrames(input: ExportSnapshot): Generator<ExportFrame> {
  for (let frame = input.startFrame; frame <= input.endFrame; frame++) {
    const rig = sampleRig(input.rig, input.tracks, frame);
    yield { rig, poses: evaluateRig(rig), phase: frame / input.frameCount };
  }
}
