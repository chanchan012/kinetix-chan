import { tracksSchema, sampleRig } from "../rig/animation";
import { evaluateRig } from "../rig/kinematics";
import { artboardFor, rigStateSchema } from "../rig/model";
import { z } from "zod";
import { celAt, type DrawingSample } from "../rig/drawings";
import { visibleLayerRows } from "../rig/layer-tree";

export const exportFormats = ["lottie", "spritesheet", "png-sequence", "mp4", "webm"] as const;
export const exportFormatSchema = z.enum(exportFormats);
export type ExportFormat = z.infer<typeof exportFormatSchema>;
export const rasterScaleSchema = z.int().min(1).max(4);

export const exportSnapshotSchema = z.strictObject({
  rig: rigStateSchema,
  name: z.string().min(1).max(120),
  fps: z.int().min(1).max(120),
  frameCount: z.int().min(1).max(36_000),
  startFrame: z.int().min(0),
  endFrame: z.int().min(0),
  tracks: tracksSchema,
  clipId:z.uuid().optional(),
  scale:rasterScaleSchema.optional(),
}).refine(clip => clip.startFrame <= clip.endFrame && clip.endFrame < clip.frameCount);
export type ExportSnapshot = z.infer<typeof exportSnapshotSchema>;
export type ExportFrame = { rig: ExportSnapshot["rig"]; poses: ReturnType<typeof evaluateRig>; phase: number; sample:DrawingSample };

export const formats: Record<ExportFormat, { label: string; mime: string; extension: string; frames: number }> = {
  lottie: { label:"Lottie JSON", mime:"application/json", extension:"json", frames:180 },
  spritesheet: { label:"Spritesheet PNG", mime:"image/png", extension:"png", frames:96 },
  "png-sequence": { label:"PNG sequence ZIP", mime:"application/zip", extension:"zip", frames:150 },
  mp4: { label:"MP4 video", mime:"video/mp4", extension:"mp4", frames:240 },
  webm: { label:"WebM video", mime:"video/webm", extension:"webm", frames:240 },
};

export function supportedExport(format: ExportFormat,snapshot: ExportSnapshot,count=snapshot.endFrame-snapshot.startFrame+1): boolean {
  const shapes = snapshot.rig.parts.reduce((total, part) => total + (part.mesh?.triangles.length ?? 1) +
    (part.facets?.faces.length ?? 0), 64);
  if (count > formats[format].frames) return false;
  if ((snapshot.scale ?? 1)>1 && format!=="spritesheet" && format!=="png-sequence") return false;
  if (format==="lottie" && containsRasterCels(snapshot)) return false;
  const { width, height } = exportDimensions(snapshot);
  if (format!=="lottie" && (width>8192 || height>8192)) return false;
  if (format !== "lottie" && width * height * count > 64 * 1024 * 1024) return false;
  if (format === "spritesheet") {
    const {columns, rows} = spritesheetGrid(count, width, height);
    if (width * columns > 8192 || height * rows > 8192) return false;
  }
  return shapes * count <= (format === "lottie" ? 40_000 : 300_000);
}

export function exportDimensions(snapshot:Pick<ExportSnapshot,"rig"|"scale">) {
  const {width,height} = artboardFor(snapshot.rig);
  const scale = snapshot.scale ?? 1;
  return {width:width*scale,height:height*scale};
}

export function containsRasterCels(snapshot:ExportSnapshot) {
  if (!snapshot.rig.drawings?.layers.length) return false;
  const visible = new Set(visibleLayerRows(snapshot.rig).flatMap(({node})=>
    node.kind==="drawing" ? [node.drawingId] : []));
  return snapshot.rig.drawings.layers.some(drawing=>{
    if (!visible.has(drawing.id)) return false;
    const track = drawing.tracks.find(item=>item.clipId===snapshot.clipId);
    const frames = [snapshot.startFrame,...(track?.keys ?? [])
      .filter(key=>key.frame>snapshot.startFrame && key.frame<=snapshot.endFrame).map(key=>key.frame)];
    return frames.some(frame=>Boolean(celAt(drawing,{clipId:snapshot.clipId,frame})?.runs.length));
  });
}

export function spritesheetGrid(frames:number, width:number, height:number) {
  const minimum = Math.ceil(frames / Math.floor(8192 / height));
  const maximum = Math.min(frames, Math.floor(8192 / width));
  const columns = Math.min(maximum, Math.max(minimum, Math.ceil(Math.sqrt(frames * height / width))));
  return { columns, rows: Math.ceil(frames / columns) };
}

export function* sampleExportFrames(input:ExportSnapshot,indices?:readonly number[]): Generator<ExportFrame> {
  const count=indices?.length ?? input.endFrame-input.startFrame+1;
  for (let index=0;index<count;index++) {
    const frame=indices ? indices[index] : input.startFrame+index;
    const rig = sampleRig(input.rig, input.tracks, frame);
    yield { rig, poses: evaluateRig(rig), phase: frame / input.frameCount, sample:{clipId:input.clipId,frame} };
  }
}
