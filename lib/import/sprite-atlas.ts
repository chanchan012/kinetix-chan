import { createHash } from "node:crypto";
import { openSpriteBundle,restoreSpritePixels } from "../export/sprite-playback";
import { rigStateSchema,type KinetixRigState } from "../rig/model";
import type { SpriteSource } from "../rig/sprite-sources";
import { applyRasterCommands,maxSamplePixels,prepareRasterArtboard,previewImage,readRuns } from "./raster-rig";
import type { AtlasClip,AtlasSummary } from "./sequence-options";

function atlasClipId(importId:string,originalId:string) {
  const bytes=createHash("sha256").update(`kinetix-sprite-import/${importId}/${originalId}`).digest().subarray(0,16);
  bytes[6]=(bytes[6]&0x0f)|0x80;
  bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=bytes.toString("hex");
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");
}

export async function planSpriteAtlas(rig:KinetixRigState,archive:Uint8Array,options:{
  id:string;name:string;resizeArtboard:boolean;preflight:boolean;
}) {
  const {manifest,textures}=await openSpriteBundle(archive);
  const {width,height}=manifest.clips[0].frames[0].sourceSize;
  if (width>4096 || height>4096) throw new Error("Editable sprite frames are limited to 4096 pixels per side.");
  if (manifest.clips.some(clip=>clip.durationTicks>36000)) throw new Error("A sprite clip exceeds the 36,000-tick Studio limit.");
  let pixels=0;
  for (const clip of manifest.clips) for (const frame of clip.frames) {
    if (frame.sourceSize.width!==width || frame.sourceSize.height!==height) throw new Error("All sprite frames must use the same source dimensions.");
    if (!frame.blank) pixels+=frame.rect.width*frame.rect.height;
  }
  if (pixels>maxSamplePixels) throw new Error("The sprite crops exceed the editable sample budget. Import fewer clips or smaller crops.");

  const drawingId=`atlas-${options.id}`;
  const notes=new Set<string>();
  const commands=prepareRasterArtboard(rig,width,height,options.resizeArtboard,notes);
  commands.push({type:"drawing.create",drawing:{id:drawingId,name:options.name,width,height,storage:{mode:"rgba"}}});
  if (manifest.source.pixelScale>1) notes.add("Cels retain their source pixels. Preserved sprite export retains the bundle’s original world scale.");
  if (manifest.texture.alpha!=="straight" || manifest.texture.colorSpace!=="srgb") {
    notes.add("Texture channels are normalized to straight sRGB for editing.");
  }
  const sources:SpriteSource[]=[];
  const clips:AtlasClip[]=[];
  const companion={pivots:0,sockets:0,collisions:0,events:0};
  let celCount=0;
  let blankFrames=0;
  let runCount=0;
  let previewPng:string|undefined;
  for (const clip of manifest.clips) {
    const id=atlasClipId(options.id,clip.id);
    const frames:SpriteSource["frames"]=[];
    let previous:string|undefined;
    for (const frame of clip.frames) {
      const {startTick,durationTicks,pivot,origin,sockets,collisions,events}=frame;
      frames.push({startTick,durationTicks,pivot,origin,sockets,collisions,events});
      companion.pivots++;
      companion.sockets+=sockets.length;
      companion.collisions+=collisions.length;
      companion.events+=events.length;
      const crop=frame.blank ? null : restoreSpritePixels(textures.get(frame.file)!,frame,manifest.texture);
      const bytes=crop ? Buffer.from(crop.pixels.buffer,crop.pixels.byteOffset,crop.pixels.byteLength) : Buffer.alloc(0);
      const runs=crop ? readRuns(bytes,crop.width,crop.height,frame.trimOffset.x,frame.trimOffset.y) : [];
      if (!runs.length) blankFrames++;
      const signature=runs.length ? JSON.stringify(runs) : "";
      if (signature===previous) continue;
      previous=signature;
      let celId:string|null=null;
      if (runs.length && crop) {
        runCount+=runs.length;
        if (runCount>100_000) throw new Error("The sprite frames exceed the editable pixel run budget.");
        celId=`${drawingId}-${++celCount}`;
        commands.push({type:"cel.create",drawingId,id:celId},{type:"cel.replace",drawingId,id:celId,runs});
        if (options.preflight && !previewPng) {
          const full=Buffer.alloc(width*height*4);
          for (let y=0;y<crop.height;y++) {
            const offset=((frame.trimOffset.y+y)*width+frame.trimOffset.x)*4;
            bytes.copy(full,offset,y*crop.width*4,(y+1)*crop.width*4);
          }
          previewPng=previewImage(full,width,height);
        }
      }
      commands.push({type:"exposure.set",drawingId,clipId:id,key:{frame:startTick,celId}});
    }
    sources.push({clipId:id,originalClipId:clip.id,sourceScale:manifest.source.pixelScale,direction:clip.direction,loopMode:clip.loopMode,frames});
    clips.push({id,originalClipId:clip.id,name:clip.name.trim() || "Sprite clip",fps:clip.ticksPerSecond,frameCount:clip.durationTicks,
      trackRevision:0,tracks:[],direction:clip.direction,loopMode:clip.loopMode,sourceFrames:clip.frames.length});
  }
  if (companion.sockets || companion.collisions || companion.events) {
    notes.add("Sockets, collisions and cues are retained for sprite re-export. Studio edits their artwork and timing.");
  }
  const candidate=applyRasterCommands(rig,commands);
  const result=rigStateSchema.safeParse({...candidate,spriteSources:[...(rig.spriteSources ?? []),...sources]});
  if (!result.success) throw new Error(result.error.issues[0]?.message ?? "The sprite metadata exceeds the project’s capacity.");
  const summary:AtlasSummary={layout:manifest.layout,sourceScale:manifest.source.pixelScale,width,height,celCount,blankFrames,clips,companion,notes:[...notes]};
  return {state:result.data,summary,drawingId,previewPng};
}
