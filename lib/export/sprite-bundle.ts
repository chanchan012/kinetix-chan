import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import type { ExportQueue } from "../../db/exports";
import { artboardFor, readRigState } from "../rig/model";
import { exportDimensions, exportSnapshotSchema, supportedExport, type ExportSnapshot } from "./frames";
import { sampleRgbaFrames } from "./raster";
import { defaultSpritePacking, type SpriteBundleRequest } from "./sprite-bundle-options";
import { blitSprite, cropSprite, placeSprites, type SpriteCrop } from "./sprite-layout";
import { spritePng } from "./sprite-png";

const maxBundleBytes=1_500_000;
const maxPagePixels=16*1024*1024;
const maxSamplePixels=64*1024*1024;
const zipTime=new Date(1980,0,1);
const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");

type ClipRequest=SpriteBundleRequest["clips"][number];
type SavedClip={request:ClipRequest;snapshot:ExportSnapshot};

function clipFrames(clip:SavedClip,scale:number,sourceSize:ReturnType<typeof exportDimensions>) {
  const {request,snapshot}=clip;
  const artboard=artboardFor(snapshot.rig);
  const point=({x,y}:{x:number;y:number})=>({x:x*scale,y:y*scale});
  const defaultPivot=request.pivot ?? {x:artboard.width/2,y:artboard.height};
  const settings=new Map(request.frames?.map(frame=>[frame.frame,frame]));
  const count=request.endFrame-request.startFrame+1;
  let tick=0;
  return Array.from({length:count},(_,index)=>{
    const sourceFrame=request.startFrame+index;
    const metadata=settings.get(sourceFrame);
    const durationTicks=metadata?.durationTicks ?? 1;
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
      events:metadata?.events ?? [],
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
  for (const [index,clip] of request.clips.entries()) {
    const stored=rows[index]!.clip!;
    const parsed=exportSnapshotSchema.safeParse({
      rig,name:stored.name,fps:stored.fps,frameCount:stored.frameCount,tracks:stored.tracks,
      clipId:stored.id,startFrame:clip.startFrame,endFrame:clip.endFrame,scale:request.scale,
    });
    if (!parsed.success || !supportedExport("png-sequence",parsed.data)) return {error:"unsupported_range",status:400} as const;
    saved.push({request:clip,snapshot:parsed.data});
  }
  const sourceSize=exportDimensions(saved[0].snapshot);
  const count=saved.reduce((n,clip)=>n+clip.request.endFrame-clip.request.startFrame+1,0);
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
    for (const frame of sampleRgbaFrames(clip.snapshot)) {
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
  const clips=saved.map(clip=>{
    const frames=clipFrames(clip,request.scale,sourceSize).map(frame=>{
      const crop=frameCrops[index++];
      const {page,rect,rotation}=layout.placements[crop.cropIndex];
      return {...frame,file:layout.pages[page].file,rect,rotation,blank:crop.blank,trimOffset:{x:crop.x,y:crop.y}};
    });
    return {
      id:clip.request.id,name:clip.snapshot.name,direction:clip.request.direction,
      trackRevision:clip.request.trackRevision,startFrame:clip.request.startFrame,endFrame:clip.request.endFrame,
      loopMode:clip.request.loopMode,ticksPerSecond:clip.snapshot.fps,
      durationTicks:frames.reduce((sum,frame)=>sum+frame.durationTicks,0),frames,
    };
  });
  const manifest={
    schema:"kinetix.sprite-package",version:2,layout:request.layout,
    source:{rigId,revision:request.revision,pixelScale:request.scale},
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
