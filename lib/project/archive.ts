import { createHash } from "node:crypto";
import { strFromU8,strToU8,unzipSync,zipSync } from "fflate";
import { z } from "zod";
import { tracksSchema } from "../rig/animation";
import { artboardFor,rigStateSchema,studyIdSchema,type KinetixRigState } from "../rig/model";
import { archiveName,projectArchiveByteLimit,projectArchiveClipLimit,type ProjectArchiveSummary } from "./archive-options";

const documentFile="document.json";
const animationFile="animation.json";
const manifestFile="manifest.json";
const maxContentsBytes=16*1024*1024;
const maxManifestBytes=16*1024;
const zipTime=new Date(1980,0,1);
const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const file=z.strictObject({bytes:z.int().min(1).max(maxContentsBytes),sha256:z.string().regex(/^[a-f0-9]{64}$/)});

const manifestSchema=z.strictObject({
  schema:z.literal("kinetix.project"),version:z.literal(1),name:archiveName,
  source:z.strictObject({id:z.uuid(),revision:z.int().min(0).max(2_147_483_647)}),
  dependencies:z.strictObject({study:studyIdSchema.nullable()}),
  omissions:z.strictObject({orphanExposureTracks:z.int().min(0),orphanSpriteSources:z.int().min(0),orphanChannels:z.int().min(0)}),
  files:z.strictObject({[documentFile]:file,[animationFile]:file}),
});
type Manifest=z.output<typeof manifestSchema>;

const clipSchema=z.strictObject({
  id:z.uuid(),name:archiveName,fps:z.int().min(1).max(120),frameCount:z.int().min(1).max(36_000),
  trackRevision:z.int().min(0).max(2_147_483_647),tracks:tracksSchema,
});
const clipsSchema=z.array(clipSchema).max(projectArchiveClipLimit).superRefine((clips,ctx)=>{
  if (new Set(clips.map(clip=>clip.id)).size!==clips.length) ctx.addIssue({code:"custom",message:"Duplicate clip IDs."});
  for (const clip of clips) {
    if (clip.tracks.some(track=>track.keys.at(-1)!.frame>=clip.frameCount)) {
      ctx.addIssue({code:"custom",message:"A keyframe exceeds the clip length."});
    }
  }
});
export type ArchivedClip=z.output<typeof clipSchema>;
type ProjectArchive={manifest:Manifest;state:KinetixRigState;clips:ArchivedClip[]};

function references(state:KinetixRigState,clips:ArchivedClip[]) {
  const ids=new Set(clips.map(clip=>clip.id));
  const targets={bone:new Set(state.bones.map(bone=>bone.id)),part:new Set(state.parts.map(part=>part.id)),
    ik:new Set(state.constraints.map(constraint=>constraint.id))};
  const omissions={orphanExposureTracks:0,orphanSpriteSources:0,orphanChannels:0};
  const drawings=state.drawings && {...state.drawings,layers:state.drawings.layers.map(drawing=>{
    const tracks=drawing.tracks.filter(track=>ids.has(track.clipId));
    omissions.orphanExposureTracks+=drawing.tracks.length-tracks.length;
    return {...drawing,tracks};
  })};
  const spriteSources=state.spriteSources?.filter(source=>ids.has(source.clipId));
  omissions.orphanSpriteSources=(state.spriteSources?.length ?? 0)-(spriteSources?.length ?? 0);
  const activeClips=clips.map(clip=>{
    const tracks=clip.tracks.filter(({channel})=>targets[channel.kind].has(channel.id));
    omissions.orphanChannels+=clip.tracks.length-tracks.length;
    return {...clip,tracks};
  });
  return {state:{...state,...(drawings && {drawings}),...(spriteSources && {spriteSources})},clips:activeClips,omissions};
}

export function archiveSummary({manifest,state,clips}:ProjectArchive):ProjectArchiveSummary {
  const {width,height,background}=artboardFor(state);
  const {orphanExposureTracks,orphanSpriteSources,orphanChannels}=manifest.omissions;
  const warnings=[];
  if (orphanExposureTracks || orphanSpriteSources) warnings.push("The source contained drawing tracks or sprite metadata for deleted clips. Those references were removed.");
  if (orphanChannels) warnings.push("Animation channels targeting deleted artwork or bones were removed.");
  return {name:manifest.name,artboard:{width,height,background},study:state.study ?? undefined,documentVersion:state.version,
    parts:state.parts.length,drawings:state.drawings?.layers.length ?? 0,bones:state.bones.length,
    clips:clips.map(({id,name,fps,frameCount,trackRevision})=>({id,name,fps,frameCount,trackRevision})),warnings};
}

export function writeProjectArchive(project:{id:string;revision:number;name:string;state:unknown;clips:unknown[]}) {
  const state=rigStateSchema.parse(project.state);
  const clips=clipsSchema.parse(project.clips);
  const active=references(state,clips);
  const files={
    [documentFile]:strToU8(JSON.stringify(active.state)),
    [animationFile]:strToU8(JSON.stringify(active.clips)),
  };
  const describe=(bytes:Uint8Array)=>({bytes:bytes.length,sha256:digest(bytes)});
  const manifest=manifestSchema.parse({schema:"kinetix.project",version:1,name:project.name,source:{id:project.id,revision:project.revision},
    dependencies:{study:state.study},omissions:active.omissions,
    files:{[documentFile]:describe(files[documentFile]),[animationFile]:describe(files[animationFile])}});
  const manifestBytes=strToU8(JSON.stringify(manifest,null,2));
  if (manifestBytes.length+files[documentFile].length+files[animationFile].length>maxContentsBytes) {
    throw new Error("The project exceeds the 16 MiB decoded archive limit.");
  }
  const bytes=zipSync({[manifestFile]:manifestBytes,...files},{level:6,mtime:zipTime});
  if (bytes.length>projectArchiveByteLimit) throw new Error("The compressed project exceeds the 2 MiB archive limit.");
  return {manifest,bytes,summary:archiveSummary({manifest,...active})};
}

export function readProjectArchive(bytes:Uint8Array):ProjectArchive {
  if (bytes.length>projectArchiveByteLimit) throw new Error("Choose a project ZIP of 2 MiB or less.");
  const entries=new Set<string>();
  let size=0;
  let files:Record<string,Uint8Array>;
  try {
    files=unzipSync(bytes,{filter:entry=>{
      if (![manifestFile,documentFile,animationFile].includes(entry.name) || entries.has(entry.name)) {
        throw new Error("The project ZIP contains an unexpected or duplicate entry.");
      }
      entries.add(entry.name);
      size+=entry.originalSize;
      if (size>maxContentsBytes || (entry.name===manifestFile && entry.originalSize>maxManifestBytes)) {
        throw new Error("The decoded project exceeds the archive limit.");
      }
      return true;
    }});
  } catch (error) {
    throw new Error(error instanceof Error && error.message.startsWith("The ") ? error.message : "Choose a valid Kinetix project ZIP.");
  }
  if (entries.size!==3) throw new Error("The ZIP needs a manifest, a document and saved animation data.");
  function readJson(name:string):unknown {
    try {return JSON.parse(strFromU8(files[name]));}
    catch {throw new Error(`The project file ${name} contains invalid JSON.`);}
  }
  const raw=readJson(manifestFile);
  const parsed=manifestSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Choose a supported version 1 Kinetix project archive.");
  const manifest=parsed.data;
  for (const name of [documentFile,animationFile] as const) {
    const expected=manifest.files[name];
    if (files[name].length!==expected.bytes || digest(files[name])!==expected.sha256) {
      throw new Error(`The project file ${name} failed its integrity check.`);
    }
  }
  const state=rigStateSchema.safeParse(readJson(documentFile));
  const clips=clipsSchema.safeParse(readJson(animationFile));
  if (!state.success) throw new Error("The project contains an unsupported or invalid editable document.");
  if (!clips.success) throw new Error("The project contains invalid clip tracks or timing.");
  if (manifest.dependencies.study!==state.data.study || Object.values(references(state.data,clips.data).omissions).some(Boolean)) {
    throw new Error("The project contains unresolved document, study or clip references.");
  }
  return {manifest,state:state.data,clips:clips.data};
}

function derivedId(label:string,fields:string[]) {
  const bytes=createHash("sha256").update(JSON.stringify([label,...fields])).digest().subarray(0,16);
  bytes[6]=(bytes[6]&0x0f)|0x80;
  bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=bytes.toString("hex");
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");
}

export function planProjectReopen(project:ProjectArchive,owner:string,importId:string,archive:Uint8Array,name:string) {
  const id=derivedId("kinetix-project-reopen",[owner,importId,digest(archive),name]);
  const clipIds=Object.fromEntries(project.clips.map(clip=>[clip.id,derivedId("kinetix-project-clip",[id,clip.id])]));
  const {state}=project;
  return {id,clipIds,name,state:{...state,
    ...(state.drawings && {drawings:{...state.drawings,layers:state.drawings.layers.map(drawing=>({...drawing,
      tracks:drawing.tracks.map(track=>({...track,clipId:clipIds[track.clipId]})),
    }))}}),
    ...(state.spriteSources && {spriteSources:state.spriteSources.map(source=>({...source,clipId:clipIds[source.clipId]}))}),
  },clips:project.clips.map(clip=>({...clip,id:clipIds[clip.id],trackRevision:0}))};
}
