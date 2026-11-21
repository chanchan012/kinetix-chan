import { z } from "zod";
import { spriteMaxFrames } from "./sprite-package-options";

const coordinate = z.number().min(-8192).max(8192);
const point = z.strictObject({x:coordinate,y:coordinate});
const label = z.string().trim().min(1).max(80);
const sampleFrame = z.int().min(0).max(35_999);
const ticks = z.int().min(1).max(10_000);
const socket = point.extend({name:label,angle:z.number().min(-1000).max(1000).default(0)});
const collision = z.discriminatedUnion("kind",[
  point.extend({kind:z.literal("rect"),name:label,width:z.number().gt(0).max(8192),height:z.number().gt(0).max(8192)}),
  z.strictObject({kind:z.literal("polygon"),name:label,points:z.array(point).min(3).max(64)}),
]);
const event = z.strictObject({
  name:label,
  tick:z.int().min(0).max(9999).default(0),
  data:z.record(z.string().min(1).max(40),z.union([z.string().max(256),z.number(),z.boolean(),z.null()])).optional(),
}).refine(event=>!event.data || Object.keys(event.data).length<=16,"An event supports up to 16 data fields.");
const frameMetadata = z.strictObject({
  frame:sampleFrame,
  durationTicks:ticks.default(1),
  pivot:point.optional(),
  origin:point.optional(),
  sockets:z.array(socket).max(32).optional(),
  collisions:z.array(collision).max(32).optional(),
  events:z.array(event).max(32).optional(),
}).refine(frame=>!frame.events?.some(event=>event.tick>=frame.durationTicks),"Events must occur within the frame hold.");

const clip = z.strictObject({
  id:z.uuid(),
  trackRevision:z.int().min(0),
  startFrame:sampleFrame,
  endFrame:sampleFrame,
  direction:label.optional(),
  loopMode:z.enum(["once","repeat","ping-pong"]).default("repeat"),
  preserveImportedTiming:z.boolean().optional(),
  pivot:point.optional(),
  origin:point.optional(),
  frames:z.array(frameMetadata).max(spriteMaxFrames).optional(),
}).superRefine((clip,context)=>{
  if (clip.startFrame>clip.endFrame) {
    context.addIssue({code:"custom",path:["endFrame"],message:"The last frame must follow the first frame."});
  }
  const unique = new Set(clip.frames?.map(frame=>frame.frame));
  if (clip.frames && (unique.size!==clip.frames.length ||
      clip.frames.some(frame=>frame.frame<clip.startFrame || frame.frame>clip.endFrame))) {
    context.addIssue({code:"custom",path:["frames"],message:"Use one metadata record per frame inside the exported range."});
  }
  if (clip.preserveImportedTiming && (clip.direction || clip.pivot || clip.origin || clip.frames || clip.loopMode!=="repeat")) {
    context.addIssue({code:"custom",path:["preserveImportedTiming"],message:"Turn off imported timing to override companion data or loop settings."});
  }
});

const packing = z.strictObject({
  trim:z.boolean().default(true),
  padding:z.int().min(0).max(16).default(2),
  extrusion:z.int().min(0).max(8).default(1),
  rotate:z.boolean().default(false),
});
const commonSpriteOptions = {
  revision:z.int().min(0),
  clips:z.array(clip).min(1).max(16),
  scale:z.int().min(1).max(4).default(1),
  maxTextureSize:z.int().min(16).max(8192).default(2048),
  filter:z.enum(["nearest","linear"]).default("nearest"),
  preflight:z.boolean().default(false),
};

function validateSelection(request:{clips:z.output<typeof clip>[]},context:z.RefinementCtx) {
  const ids = new Set(request.clips.map(clip=>clip.id));
  if (ids.size!==request.clips.length) context.addIssue({
    code:"custom",path:["clips"],message:"Choose each clip once per export.",
  });
  if (request.clips.reduce((sum,clip)=>sum+(clip.preserveImportedTiming ? 1 : clip.endFrame-clip.startFrame+1),0)>spriteMaxFrames) {
    context.addIssue({code:"custom",path:["clips"],message:"Export up to "+spriteMaxFrames+" frames per package."});
  }
}

export const spriteBundleRequest = z.strictObject({
  ...commonSpriteOptions,
  layout:z.enum(["loose","fixed-grid","packed"]),
  colorSpace:z.enum(["srgb","linear"]).default("srgb"),
  alpha:z.enum(["straight","premultiplied"]).default("straight"),
  packing:packing.optional(),
}).superRefine((request,context)=>{
  validateSelection(request,context);
  if (request.packing && request.layout!=="packed") context.addIssue({
    code:"custom",path:["packing"],message:"Packing controls apply to packed atlases.",
  });
});
export type SpriteBundleRequest = z.output<typeof spriteBundleRequest>;
export const defaultSpritePacking = packing.parse({});

export const fixedSpriteBundleRequest=z.strictObject({
  ...commonSpriteOptions,
  layout:z.enum(["loose","fixed-grid"]),
  fps:z.int().min(1).max(120),
}).superRefine(validateSelection);
export type FixedSpriteBundleRequest=z.output<typeof fixedSpriteBundleRequest>;
