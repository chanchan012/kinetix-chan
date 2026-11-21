import { strFromU8,unzipSync } from "fflate";
import { z } from "zod";
import { spriteCompanionFields,spriteLoopMode } from "../rig/sprite-sources";
import { readSpritePng } from "./sprite-playback";
import { planFixedSpriteTiming } from "./fixed-sprite-timing";

export const fixedSpriteLimits={frames:960,pixels:16*1024*1024,bytes:1_500_000} as const;
const frameIndex=z.int().min(0).max(fixedSpriteLimits.frames-1);
const frameCount=z.int().min(1).max(fixedSpriteLimits.frames);
const size=z.int().min(1).max(8192);
const dimensions=z.strictObject({width:size,height:size});
const id=z.string().min(1).max(80);
const sourceTick=z.int().min(0).max(1_920_000);
const filePath=z.string().regex(/^[0-9a-f-]{36}\/(frame|sheet)-[0-9]{5}\.png$/i);
const sourceFrame=z.strictObject({id,sourceFrame:z.int().min(0).max(35_999),...spriteCompanionFields});
const run=z.strictObject({frameId:id,sourceTick,outputStart:z.int().min(0).max(fixedSpriteLimits.frames),
  frameCount:frameCount.min(0)});
const cue=z.strictObject({frameId:id,sourceTick,outputFrame:frameIndex,name:id,
  data:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])).optional(),errorMs:z.number()});
const clip=z.strictObject({
  id:z.uuid(),name:z.string().min(1).max(120),direction:id.optional(),trackRevision:z.int().min(0),
  startFrame:z.int().min(0).max(35_999),endFrame:z.int().min(0).max(35_999),loopMode:spriteLoopMode,
  ticksPerSecond:z.int().min(1).max(120),durationTicks:sourceTick.min(1),frames:z.array(sourceFrame).min(1).max(96),
  totalFrames:frameCount,sourceLoopTicks:sourceTick.min(1),runs:z.array(run).min(1).max(190),cues:z.array(cue).max(6080),
  droppedVisits:z.int().min(0).max(190),durationErrorMs:z.number(),maxBoundaryErrorMs:z.number().min(0),maxCueErrorMs:z.number().min(0),
});
const file=dimensions.extend({file:filePath,columns:frameCount,rows:frameCount,clipId:z.uuid(),firstFrame:frameIndex,frameCount,
  bytes:z.int().min(1).max(fixedSpriteLimits.bytes),sha256:z.string().regex(/^[a-f0-9]{64}$/)});

function cueValues(data:z.infer<typeof cue>) {
  return [data.frameId,data.sourceTick,data.outputFrame,data.name,data.errorMs,
    Object.entries(data.data ?? {}).sort(([left],[right])=>left<right?-1:left===right?0:1)];
}

export const fixedSpriteManifest=z.strictObject({
  schema:z.literal("kinetix.fixed-sprites"),version:z.literal(1),layout:z.enum(["loose","fixed-grid"]),
  fps:z.int().min(1).max(120),cell:dimensions,
  source:z.strictObject({rigId:z.uuid(),revision:z.int().min(0),pixelScale:z.int().min(1).max(4)}),
  texture:z.strictObject({colorSpace:z.literal("srgb"),alpha:z.literal("straight"),filter:z.enum(["nearest","linear"])}),
  textureBytes:z.int().min(4).max(fixedSpriteLimits.pixels*4),clips:z.array(clip).min(1).max(16),
  files:z.array(file).min(1).max(fixedSpriteLimits.frames),
}).superRefine((manifest,ctx)=>{
  const fail=(message:string)=>ctx.addIssue({code:"custom",message});
  const {files,clips,cell,layout,fps}=manifest;
  if (new Set(files.map(page=>page.file)).size!==files.length || new Set(clips.map(clip=>clip.id)).size!==clips.length ||
      clips.reduce((n,clip)=>n+clip.frames.length,0)>96 || clips.reduce((n,clip)=>n+clip.totalFrames,0)>fixedSpriteLimits.frames ||
      manifest.textureBytes!==files.reduce((n,page)=>n+page.width*page.height*4,0) || files.some(page=>!clips.some(clip=>clip.id===page.clipId))) {
    fail("Invalid fixed sprite inventory or texture budget.");
    return;
  }
  for (const clip of clips) {
    let tick=0;
    for (const [index,frame] of clip.frames.entries()) {
      const sourceIndex=clip.startFrame+index;
      if (frame.startTick!==tick || frame.sourceFrame!==sourceIndex || frame.id!==`${clip.id}:${sourceIndex}` ||
          frame.events.some(event=>event.tick>=frame.durationTicks)) {
        fail("Invalid source timeline in "+clip.id);
        return;
      }
      tick+=frame.durationTicks;
    }
    const expected=planFixedSpriteTiming(clip,fps);
    if (clip.endFrame!==clip.startFrame+clip.frames.length-1 || tick!==clip.durationTicks ||
        clip.totalFrames!==expected.totalFrames || clip.sourceLoopTicks!==expected.sourceLoopTicks ||
        clip.droppedVisits!==expected.droppedVisits || clip.durationErrorMs!==expected.durationErrorMs ||
        clip.maxBoundaryErrorMs!==expected.maxBoundaryErrorMs || clip.maxCueErrorMs!==expected.maxCueErrorMs ||
        JSON.stringify(clip.runs)!==JSON.stringify(expected.runs) ||
        JSON.stringify(clip.cues.map(cueValues))!==JSON.stringify(expected.cues.map(cueValues))) {
      fail("Invalid fixed-rate timing map in "+clip.id);
      return;
    }
    let firstFrame=0;
    const pages=files.filter(page=>page.clipId===clip.id);
    for (const [index,page] of pages.entries()) {
      const filename=`${clip.id}/${layout==="loose"?"frame":"sheet"}-${String(index+1).padStart(5,"0")}.png`;
      if (page.file!==filename || page.firstFrame!==firstFrame || page.width!==page.columns*cell.width ||
          page.height!==page.rows*cell.height || page.rows!==Math.ceil(page.frameCount/page.columns) ||
          (layout==="loose" && (page.columns!==1 || page.frameCount!==1))) {
        fail("Invalid image slice layout in "+clip.id);
        return;
      }
      firstFrame+=page.frameCount;
    }
    if (firstFrame!==clip.totalFrames) { fail("Image slices do not cover clip "+clip.id); return; }
  }
});

export type FixedSpriteManifest=z.output<typeof fixedSpriteManifest>;

export async function openFixedSpriteBundle(bytes:Uint8Array) {
  if (bytes.byteLength>fixedSpriteLimits.bytes) throw new Error("The fixed sprite ZIP exceeds the size limit.");
  let total=0;
  const seen=new Set<string>();
  const entries=unzipSync(bytes,{filter:entry=>{
    if (seen.size>fixedSpriteLimits.frames || seen.has(entry.name) ||
        (entry.name!=="timing.json" && !filePath.safeParse(entry.name).success)) throw new Error("Unexpected file in fixed sprite ZIP.");
    seen.add(entry.name);
    total+=entry.originalSize;
    if (total>fixedSpriteLimits.bytes) throw new Error("Unpacked fixed sprite data exceeds the size limit.");
    return true;
  }});
  if (!entries["timing.json"]) throw new Error("The fixed sprite ZIP has no timing.json sidecar.");
  const manifest=fixedSpriteManifest.parse(JSON.parse(strFromU8(entries["timing.json"])));
  if (seen.size!==manifest.files.length+1) throw new Error("The fixed sprite ZIP does not match its file inventory.");
  const textures=new Map<string,ReturnType<typeof readSpritePng>>();
  for (const page of manifest.files) {
    const bytes=entries[page.file];
    if (!bytes || bytes.length!==page.bytes) throw new Error("Missing or incomplete image "+page.file);
    const hash=await crypto.subtle.digest("SHA-256",Uint8Array.from(bytes));
    const digest=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,"0")).join("");
    if (digest!==page.sha256) throw new Error("The checksum does not match "+page.file);
    textures.set(page.file,readSpritePng(bytes,page));
  }
  return {manifest,textures};
}

/** Read the cell using only the image grid, its dimensions and the output frame number. */
export function fixedSpritePixels(bundle:Awaited<ReturnType<typeof openFixedSpriteBundle>>,clipId:string,index:number) {
  if (!Number.isSafeInteger(index)) throw new Error("An output frame must be an integer.");
  const page=bundle.manifest.files.find(file=>file.clipId===clipId && index>=file.firstFrame && index<file.firstFrame+file.frameCount);
  if (!page) throw new Error("The fixed sprite frame is outside the clip.");
  const {width,height}=bundle.manifest.cell;
  const frame=index-page.firstFrame;
  const left=frame%page.columns*width;
  const top=Math.floor(frame/page.columns)*height;
  const texture=bundle.textures.get(page.file)!;
  const pixels=new Uint8Array(width*height*4);
  for (let y=0;y<height;y++) {
    const start=((top+y)*texture.width+left)*4;
    pixels.set(texture.rgba.subarray(start,start+width*4),y*width*4);
  }
  return pixels;
}
