import { z } from "zod";

export const maxSequenceBytes=2*1024*1024;
export const maxSequenceFrames=150;
const base64Limit=4*Math.ceil(maxSequenceBytes/3);
export const maxSequenceRequestBytes=base64Limit+16*1024;

const rasterImportFields={
  revision:z.int().min(0).max(2_147_483_646),
  importId:z.uuid().optional(),
  archive:z.string().min(4).max(base64Limit).regex(/^[A-Za-z0-9+/]+={0,2}$/).refine(value=>value.length%4===0),
  resizeArtboard:z.boolean().default(false),
  preflight:z.boolean().default(false),
};
export const sequenceImportInput=z.strictObject({...rasterImportFields,
  name:z.string().trim().min(1).max(120).default("PNG sequence"),fps:z.int().min(1).max(120).default(24),
});
export const atlasImportInput=z.strictObject({...rasterImportFields,name:z.string().trim().min(1).max(120).default("Sprite bundle")});

export type SequenceImportInput=z.output<typeof sequenceImportInput>;
export type AtlasImportInput=z.output<typeof atlasImportInput>;
export type SequenceSummary={
  width:number;height:number;fps:number;frameCount:number;sourceStartFrame:number;sourceEndFrame:number;
  timing:"manifest"|"numbered";celCount:number;exposureCount:number;heldFrames:number;blankFrames:number;
  runCount:number;notes:string[];
};

export type RasterReceipt={
  rigId:string;revision:number;importId:string;drawingId:string;applied:boolean;previewPng?:string;
};
export type ImportedClip={id:string;name:string;fps:number;frameCount:number;trackRevision:number;tracks:[]};
export type SequenceReceipt=SequenceSummary & RasterReceipt & {clip:ImportedClip};
export type AtlasClip=ImportedClip & {originalClipId:string;direction?:string;loopMode:"once"|"repeat"|"ping-pong";sourceFrames:number};
export type AtlasSummary={layout:"packed"|"fixed-grid"|"loose";sourceScale:number;width:number;height:number;
  celCount:number;blankFrames:number;notes:string[];clips:AtlasClip[];
  companion:{pivots:number;sockets:number;collisions:number;events:number};
};
export type AtlasReceipt=AtlasSummary & RasterReceipt;
