import { z } from "zod";

export const maxSequenceBytes=2*1024*1024;
export const maxSequenceFrames=150;
const base64Limit=4*Math.ceil(maxSequenceBytes/3);
export const maxSequenceRequestBytes=base64Limit+16*1024;

export const sequenceImportInput=z.strictObject({
  revision:z.int().min(0).max(2_147_483_646),
  importId:z.uuid().optional(),
  name:z.string().trim().min(1).max(120).default("PNG sequence"),
  archive:z.string().min(4).max(base64Limit).regex(/^[A-Za-z0-9+/]+={0,2}$/).refine(value=>value.length%4===0),
  fps:z.int().min(1).max(120).default(24),
  resizeArtboard:z.boolean().default(false),
  preflight:z.boolean().default(false),
});

export type SequenceImportInput=z.output<typeof sequenceImportInput>;
export type SequenceSummary={
  width:number;height:number;fps:number;frameCount:number;sourceStartFrame:number;sourceEndFrame:number;
  timing:"manifest"|"numbered";celCount:number;exposureCount:number;heldFrames:number;blankFrames:number;
  runCount:number;notes:string[];
};

export type SequenceReceipt=SequenceSummary & {
  rigId:string;revision:number;importId:string;drawingId:string;applied:boolean;previewPng?:string;
  clip:{id:string;name:string;fps:number;frameCount:number;trackRevision:number;tracks:[]};
};
