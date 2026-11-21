import { z } from "zod";

export const projectArchiveByteLimit=2*1024*1024;
export const projectArchiveClipLimit=128;
const base64Limit=4*Math.ceil(projectArchiveByteLimit/3);
export const projectArchiveRequestLimit=base64Limit+16*1024;
const revision=z.int().min(0).max(2_147_483_647);
export const archiveName=z.string().trim().min(1).max(120);

const clipRevision=z.strictObject({id:z.uuid(),trackRevision:revision});
export const exportProjectInput=z.strictObject({
  revision,clips:z.array(clipRevision).max(projectArchiveClipLimit),preflight:z.boolean().default(false),
}).refine(input=>new Set(input.clips.map(clip=>clip.id)).size===input.clips.length,"Choose each saved clip once.");

export const reopenProjectInput=z.strictObject({
  archive:z.string().min(4).max(base64Limit).regex(/^[A-Za-z0-9+/]+={0,2}$/).refine(value=>value.length%4===0),
  importId:z.uuid().optional(),name:archiveName.optional(),preflight:z.boolean().default(false),
});

export type ExportProjectInput=z.output<typeof exportProjectInput>;
export type ReopenProjectInput=z.output<typeof reopenProjectInput>;
export type ProjectArchiveSummary={
  name:string;artboard:{width:number;height:number;background:string|null};study?:string;documentVersion:number;
  parts:number;drawings:number;bones:number;
  images:number;missingImages:{id:string;name:string}[];
  clips:{id:string;name:string;fps:number;frameCount:number;trackRevision:number}[];
  warnings:string[];
};
export type ProjectReopenReceipt=ProjectArchiveSummary & {
  importId:string;projectId:string;applied:boolean;reused?:boolean;clipIds:Record<string,string>;
};
