import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import type { ExportQueue } from "../../db/exports";
import { artboardFor, readRigState } from "../rig/model";
import { spriteCompanionFrameSchema,type SpriteSource } from "../rig/sprite-sources";
import { exportDimensions, exportSnapshotSchema, supportedExport, type ExportSnapshot } from "./frames";
import { sampleRgbaFrames } from "./raster";
import { defaultSpritePacking, type SpriteBundleRequest } from "./sprite-bundle-options";
import { spriteMaxFrames } from "./sprite-package-options";
import { blitSprite, cropSprite, placeSprites, type SpriteCrop } from "./sprite-layout";
import { spritePng } from "./sprite-png";

const maxBundleBytes=1_500_000;
const maxPagePixels=16*1024*1024;
const maxSamplePixels=64*1024*1024;
const zipTime=new Date(1980,0,1);
const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");

type ClipRequest=SpriteBundleRequest["clips"][number];
type SavedClip={request:ClipRequest;snapshot:ExportSnapshot;source?:SpriteSource;indices:number[]};

function sampleIndices(snapshot:ExportSnapshot,source?:SpriteSource) {
  const {startFrame:start,endFrame:end,rig,clipId,tracks}=snapshot;
  if (!source || rig.study || tracks.some(track=>track.keys.length)) {
    return Array.from({length:end-start+1},(_,index)=>start+index);
  }
  const boundaries=new Set([start,end+1]);
  function add(frame:number) { if (frame>start && frame<=end) boundaries.add(frame); }
  for (const frame of source.frames) add(frame.startTick);
  const last=source.frames.at(-1)!;
  add(last.startTick+last.durationTicks);
  for (const drawing of rig.drawings?.layers ?? []) {
    for (const key of drawing.tracks.find(track=>track.clipId===clipId)?.keys ?? []) add(key.frame);
  }
  const sorted=[...boundaries].sort((a,b)=>a-b);
  const indices=[];
  for (let i=0;i<sorted.length-1;i++) {
    for (let frame=sorted[i];frame<sorted[i+1];frame+=10_000) indices.push(frame);
  }
  return indices;
}

function clipFrames(clip:SavedClip,scale:number,sourceSize:ReturnType<typeof exportDimensions>) {
  const {request,snapshot,source,indices}=clip;
  const artboard=artboardFor(snapshot.rig);
  const point=({x,y}:{x:number;y:number})=>({x:x*scale,y:y*scale});
  const defaultPivot=request.pivot ?? {x:artboard.width/2,y:artboard.height};
  const settings=new Map(request.frames?.map(frame=>[frame.frame,frame]));
  let tick=0;
  return indices.map((sample,index)=>{
    const sourceFrame=request.startFrame+index;
    const original=source?.frames.findLast(frame=>sample>=frame.startTick && sample<frame.startTick+frame.durationTicks);
    const metadata=original ?? settings.get(sample);
    const durationTicks=source ? (indices[index+1] ?? request.endFrame+1)-sample : metadata?.durationTicks ?? 1;
    const pivot=metadata?.pivot ?? defaultPivot;
    const startTick=tick;
    tick+=durationTicks;
    return {
      id:request.id+":"+sourceFrame,sourceFrame,startTick,durationTicks,sourceSize,pivot:point(pivot),
      origin:point(metadata?.origin ?? request.origin ?? pivot),
      sockets:metadata?.sockets?.map(socket=>({...socket,...point(socket)})) ?? [],
      collisions:metadata?.collisions?.map(shape=>shape.kind==="rect" ?
        {...shape,...point(shape),width:shape.width*scale,height:shape.height*scale} :
        {...shape,points:shape.points.map(point)}) ?? [],
      events:original ? original.events.flatMap(event=>{
        const relativeTick=original.startTick+event.tick-sample;
        return relativeTick>=0 && relativeTick<durationTicks ? [{...event,tick:relativeTick}] : [];
      }) : metadata?.events ?? [],
    };
  });
}

export async function prepareSpriteBundle(queue:Pick<ExportQueue,"inputs">,owner:string,rigId:string,request:SpriteBundleRequest) {
  const rows=await Promise.all(request.clips.map(clip=>queue.inputs(owner,rigId,clip.id)));
  if (rows.some(row=>!row?.clip)) return {error:"not_found",status:404} as const;
  if (rows.some((row,index)=>row!.revision!==request.revision || row!.clip!.trackRevision!==request.clips[index].trackRevision)) {
    return {error:"revision_conflict",status:409} as const;
  }
  const rig=readRigState(rows[0]!.state);
  const saved:SavedClip[]=[];
  let count=0;
  for (const [index,clip] of request.clips.entries()) {
    const stored=rows[index]!.clip!;
    const parsed=exportSnapshotSchema.safeParse({
      rig,name:stored.name,fps:stored.fps,frameCount:stored.frameCount,tracks:stored.tracks,
      clipId:stored.id,startFrame:clip.startFrame,endFrame:clip.endFrame,scale:request.scale,
    });
    if (!parsed.success) return {error:"unsupported_range",status:400} as const;
    const source=clip.preserveImportedTiming ? rig.spriteSources?.find(item=>item.clipId===clip.id) : undefined;
    if (clip.preserveImportedTiming && !source) return {error:"imported_timing_unavailable",status:400} as const;
    const indices=sampleIndices(parsed.data,source);
    count+=indices.length;
    if (count>spriteMaxFrames) return {error:"too_many_sprite_samples",status:400} as const;
    if (!supportedExport("png-sequence",parsed.data,indices.length)) return {error:"unsupported_range",status:400} as const;
    saved.push({request:clip,snapshot:parsed.data,source,indices});
  }
  const sourceSize=exportDimensions(saved[0].snapshot);
  const pixelScale=(saved[0].source?.sourceScale ?? 1)*request.scale;
  if (pixelScale>4 || saved.some(clip=>(clip.source?.sourceScale ?? 1)*request.scale!==pixelScale)) {
    return {error:"incompatible_pixel_scale",status:400} as const;
  }
  const timings=saved.map(clip=>clipFrames(clip,request.scale,sourceSize));
  if (request.scale>1 && timings.some(frames=>frames.some(({id:_,sourceFrame:__,sourceSize:___,...companion})=>
    !spriteCompanionFrameSchema.safeParse(companion).success))) {
    return {error:"scaled_sprite_metadata_out_of_bounds",status:400} as const;
  }
  const totalSourcePixels=sourceSize.width*sourceSize.height*count;
  const packing=request.packing ?? defaultSpritePacking;
  const packed=request.layout==="packed";
  const trim=packed && packing.trim;
  if (totalSourcePixels>maxSamplePixels) return {error:"unsupported_range",status:400} as const;
  if (!trim && (sourceSize.width>request.maxTextureSize || sourceSize.height>request.maxTextureSize)) {
    return {error:"frame_exceeds_texture_size",status:400} as const;
  }
  if (!packed && totalSourcePixels>maxPagePixels) return {error:"atlas_too_large",status:400} as const;

  const crops:SpriteCrop[]=[];
  const frameCrops:{cropIndex:number;x:number;y:number;blank:boolean}[]=[];
  const heldTextures=new Map<string,number>();
  let storedPixels=0;
  for (const clip of saved) {
    for (const frame of sampleRgbaFrames(clip.snapshot,clip.indices)) {
      const crop=cropSprite(frame.rgba,sourceSize,trim);
      const key=packed ? crop.width+"x"+crop.height+":"+digest(new Uint8Array(
        crop.rgba.buffer,crop.rgba.byteOffset,crop.rgba.byteLength,
      )) : undefined;
      let cropIndex=key ? heldTextures.get(key) : undefined;
      if (cropIndex===undefined) {
        storedPixels+=crop.width*crop.height;
        if (storedPixels>maxPagePixels) return {error:"atlas_too_large",status:400} as const;
        cropIndex=crops.length;
        crops.push(request.preflight ? {...crop,rgba:new Uint8ClampedArray(0)} : crop);
        if (key) heldTextures.set(key,cropIndex);
      }
      frameCrops.push({cropIndex,x:crop.x,y:crop.y,blank:crop.blank});
    }
  }
  const layout=placeSprites(crops,request.layout,request.maxTextureSize,packing);
  if (!layout) return {error:"frame_exceeds_texture_size",status:400} as const;
  const texels=layout.pages.reduce((n,page)=>n+page.width*page.height,0);
  if (texels>maxPagePixels) return {error:"atlas_too_large",status:400} as const;

  let index=0;
  const clips=saved.map((clip,clipIndex)=>{
    const frames=timings[clipIndex].map(frame=>{
      const crop=frameCrops[index++];
      const {page,rect,rotation}=layout.placements[crop.cropIndex];
      return {...frame,file:layout.pages[page].file,rect,rotation,blank:crop.blank,trimOffset:{x:crop.x,y:crop.y}};
    });
    return {
      id:clip.request.id,name:clip.snapshot.name,direction:clip.source?.direction ?? clip.request.direction,
      trackRevision:clip.request.trackRevision,startFrame:clip.request.startFrame,endFrame:frames.at(-1)!.sourceFrame,
      loopMode:clip.source?.loopMode ?? clip.request.loopMode,ticksPerSecond:clip.snapshot.fps,
      durationTicks:frames.reduce((sum,frame)=>sum+frame.durationTicks,0),frames,
    };
  });
  const manifest={
    schema:"kinetix.sprite-package",version:2,layout:request.layout,
    source:{rigId,revision:request.revision,pixelScale},
    texture:{
      filter:request.filter,alpha:request.alpha,colorSpace:request.colorSpace,maxSize:request.maxTextureSize,
      padding:packed?packing.padding:0,extrusion:packed?packing.extrusion:0,trim,rotate:packed&&packing.rotate,
    },
    textureBytes:texels*4,
    clips,files:layout.pages,
  } as const;
  if (request.preflight) return {manifest} as const;
  const files:Record<string,Uint8Array>={};
  let encodedBytes=0;
  const details=[];
  for (const [page,texture] of layout.pages.entries()) {
    const pixels=new Uint8Array(texture.width*texture.height*4);
    for (const [index,placement] of layout.placements.entries()) if (placement.page===page) {
      blitSprite(pixels,texture.width,crops[index],placement,manifest.texture.extrusion,request.colorSpace,request.alpha);
    }
    const png=spritePng(texture.width,texture.height,pixels,request.colorSpace);
    encodedBytes+=png.byteLength;
    if (encodedBytes>maxBundleBytes) return {error:"package_too_large",status:400} as const;
    files[texture.file]=png;
    details.push({...texture,sha256:digest(png),bytes:png.byteLength});
  }
  const complete={...manifest,files:details};
  const manifestBytes=strToU8(JSON.stringify(complete,null,2));
  if (encodedBytes+manifestBytes.byteLength>maxBundleBytes) return {error:"package_too_large",status:400} as const;
  const bytes=zipSync({"kinetix.json":manifestBytes,...files},{level:0,mtime:zipTime});
  return bytes.byteLength>maxBundleBytes ? {error:"package_too_large",status:400} as const : {manifest:complete,bytes} as const;
}
