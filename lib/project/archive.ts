import { createHash } from "node:crypto";
import { strFromU8,strToU8,unzipSync,zipSync } from "fflate";
import { z } from "zod";
import { tracksSchema } from "../rig/animation";
import { artboardFor,rigStateSchema,studyIdSchema,type KinetixRigState } from "../rig/model";
import { archiveName,projectArchiveByteLimit,projectArchiveClipLimit,type ProjectArchiveSummary } from "./archive-options";
import { imageCatalogSchema,imageCount,imageDigest,imageFileBytes,type ImageCatalog } from "../rig/images";
import { verifyProjectImages } from "../import/image-inspection";

const documentFile="document.json";
const animationFile="animation.json";
const manifestFile="manifest.json";
const maxContentsBytes=16*1024*1024;
const maxManifestBytes=32*1024;
const zipTime=new Date(1980,0,1);
const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const file=z.strictObject({bytes:z.int().min(1).max(maxContentsBytes),sha256:z.string().regex(/^[a-f0-9]{64}$/)});

const manifestFields={
  schema:z.literal("kinetix.project"),name:archiveName,
  source:z.strictObject({id:z.uuid(),revision:z.int().min(0).max(2_147_483_647)}),
  omissions:z.strictObject({orphanExposureTracks:z.int().min(0),orphanSpriteSources:z.int().min(0),orphanChannels:z.int().min(0)}),
  files:z.strictObject({[documentFile]:file,[animationFile]:file}),
};
const imagePath=z.string().regex(/^images\/[a-f0-9]{64}\.(?:png|webp)$/);
const imageDependency=z.strictObject({sha256:imageDigest,file:z.strictObject({path:imagePath,bytes:z.int().min(1).max(imageFileBytes)}).nullable()});
const manifestSchema=z.discriminatedUnion("version",[
  z.strictObject({...manifestFields,version:z.literal(1),dependencies:z.strictObject({study:studyIdSchema.nullable()})}),
  z.strictObject({...manifestFields,version:z.literal(2),dependencies:z.strictObject({study:studyIdSchema.nullable(),images:z.array(imageDependency).min(1).max(imageCount)})}),
]);
type ImageDependency=z.output<typeof imageDependency>;

function imageArchivePath(sha256:string,mimeType:string) {
  return `images/${sha256}.${mimeType==="image/png" ? "png" : "webp"}`;
}

function packedImages(catalog:ImageCatalog|undefined) {
  const files:Record<string,Uint8Array>={};
  const entries:ImageDependency[]=[];
  if (!catalog?.assets.length) return {files,entries};
  const sources=new Map(catalog.sources.map(source=>[source.sha256,source.base64]));
  const types=new Map(catalog.assets.map(asset=>[asset.sha256,asset.mimeType]));
  for (const [sha256,mimeType] of [...types.entries()].sort(([a],[b])=>a.localeCompare(b))) {
    const base64=sources.get(sha256);
    let file:ImageDependency["file"]=null;
    if (base64) {
      const path=imageArchivePath(sha256,mimeType);
      const bytes=Buffer.from(base64,"base64");
      files[path]=bytes;
      file={path,bytes:bytes.length};
    }
    entries.push({sha256,file});
  }
  return {files,entries};
}

function unpackedImages(catalog:ImageCatalog|undefined,dependencies:ImageDependency[],files:Record<string,Uint8Array>) {
  if (!catalog?.assets.length || catalog.sources.length) throw new Error("The project image catalog must use the archived image entries.");
  const types=new Map(catalog.assets.map(asset=>[asset.sha256,asset.mimeType]));
  const declared=new Set<string>();
  const seen=new Set<string>();
  const sources:ImageCatalog["sources"]=[];
  for (const {sha256,file} of dependencies) {
    const type=types.get(sha256);
    if (!type || seen.has(sha256) || (file && file.path!==imageArchivePath(sha256,type))) {
      throw new Error("The project image dependencies do not match the document catalog.");
    }
    seen.add(sha256);
    if (!file) continue;
    declared.add(file.path);
    const bytes=files[file.path];
    if (!bytes) continue;
    if (bytes.length!==file.bytes || digest(bytes)!==sha256) throw new Error("An archived image failed its integrity check.");
    sources.push({sha256,base64:Buffer.from(bytes).toString("base64")});
  }
  if (seen.size!==types.size || Object.keys(files).some(path=>imagePath.safeParse(path).success && !declared.has(path))) {
    throw new Error("The ZIP contains undeclared or unresolved image dependencies.");
  }
  const result=imageCatalogSchema.parse({assets:catalog.assets,sources});
  verifyProjectImages(result);
  return result;
}
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
  const present=new Set(state.images?.sources.map(source=>source.sha256));
  const missingImages=state.images?.assets.filter(asset=>!present.has(asset.sha256)).map(({id,name})=>({id,name})) ?? [];
  return {name:manifest.name,artboard:{width,height,background},study:state.study ?? undefined,documentVersion:state.version,
    parts:state.parts.length,drawings:state.drawings?.layers.length ?? 0,bones:state.bones.length,
    images:state.images?.assets.length ?? 0,missingImages,
    clips:clips.map(({id,name,fps,frameCount,trackRevision})=>({id,name,fps,frameCount,trackRevision})),warnings};
}

export function writeProjectArchive(project:{id:string;revision:number;name:string;state:unknown;clips:unknown[]}) {
  const state=rigStateSchema.parse(project.state);
  const clips=clipsSchema.parse(project.clips);
  const active=references(state,clips);
  const {images,...document}=active.state;
  verifyProjectImages(images);
  const packed=packedImages(images);
  const files={
    ...packed.files,
    [documentFile]:strToU8(JSON.stringify({...document,...(packed.entries.length && {images:{assets:images!.assets,sources:[]}})})),
    [animationFile]:strToU8(JSON.stringify(active.clips)),
  };
  const describe=(bytes:Uint8Array)=>({bytes:bytes.length,sha256:digest(bytes)});
  const manifest=manifestSchema.parse({schema:"kinetix.project",version:packed.entries.length ? 2 : 1,name:project.name,source:{id:project.id,revision:project.revision},
    dependencies:{study:state.study,...(packed.entries.length && {images:packed.entries})},omissions:active.omissions,
    files:{[documentFile]:describe(files[documentFile]),[animationFile]:describe(files[animationFile])}});
  const manifestBytes=strToU8(JSON.stringify(manifest,null,2));
  if (manifestBytes.length+Object.values(files).reduce((sum,file)=>sum+file.length,0)>maxContentsBytes) {
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
      const image=imagePath.safeParse(entry.name).success;
      if ((!image && ![manifestFile,documentFile,animationFile].includes(entry.name)) || entries.has(entry.name) || entries.size>=imageCount+3) {
        throw new Error("The project ZIP contains an unexpected or duplicate entry.");
      }
      entries.add(entry.name);
      size+=entry.originalSize;
      if (size>maxContentsBytes || (entry.name===manifestFile && entry.originalSize>maxManifestBytes) || (image && entry.originalSize>imageFileBytes)) {
        throw new Error("The decoded project exceeds the archive limit.");
      }
      return true;
    }});
  } catch (error) {
    throw new Error(error instanceof Error && error.message.startsWith("The ") ? error.message : "Choose a valid Kinetix project ZIP.");
  }
  if ([manifestFile,documentFile,animationFile].some(name=>!entries.has(name))) throw new Error("The ZIP needs a manifest, a document and saved animation data.");
  function readJson(name:string):unknown {
    try {return JSON.parse(strFromU8(files[name]));}
    catch {throw new Error(`The project file ${name} contains invalid JSON.`);}
  }
  const raw=readJson(manifestFile);
  const parsed=manifestSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Choose a supported version 1 or 2 Kinetix project archive.");
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
  if (manifest.version===1 && (state.data.images?.assets.length || entries.size!==3)) {
    throw new Error("Version 1 project archives cannot declare image dependencies.");
  }
  if (manifest.version===2) state.data.images=unpackedImages(state.data.images,manifest.dependencies.images,files);
  rigStateSchema.parse(state.data);
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
