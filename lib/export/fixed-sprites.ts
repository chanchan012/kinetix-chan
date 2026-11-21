import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import type { ExportQueue } from "../../db/exports";
import { loadSpriteSamples } from "./sprite-bundle";
import { defaultSpritePacking,type FixedSpriteBundleRequest } from "./sprite-bundle-options";
import { blitSprite,cropSprite,placeSprites,type SpriteCrop } from "./sprite-layout";
import { spritePng } from "./sprite-png";
import { sampleRgbaFrames } from "./raster";
import { planFixedSpriteTiming } from "./fixed-sprite-timing";
import { fixedSpriteLimits } from "./fixed-sprite-manifest";

export async function prepareFixedSpriteBundle(queue:Pick<ExportQueue,"inputs">,owner:string,rigId:string,request:FixedSpriteBundleRequest) {
  const resolved=await loadSpriteSamples(queue,owner,rigId,request);
  if ("error" in resolved && resolved.error) return {error:resolved.error,status:resolved.status} as const;
  const {sourceSize:cell,pixelScale,saved,clips:sourceClips}=resolved;
  if (Math.max(cell.width,cell.height)>request.maxTextureSize) return {error:"frame_exceeds_texture_size",status:400} as const;
  const clips=sourceClips.map(({frames:samples,...clip})=>{
    const frames=samples.map(({sourceSize:_,...frame})=>frame);
    const source={...clip,frames};
    return {...source,...planFixedSpriteTiming(source,request.fps)};
  });
  const outputFrames=clips.reduce((count,clip)=>count+clip.totalFrames,0);
  if (outputFrames>fixedSpriteLimits.frames) return {error:"too_many_fixed_frames",status:400} as const;
  if (outputFrames*cell.width*cell.height>fixedSpriteLimits.pixels) return {error:"atlas_too_large",status:400} as const;

  const layouts=clips.map(clip=>{
    const layout=placeSprites(Array.from({length:clip.totalFrames},()=>cell),request.layout,request.maxTextureSize,defaultSpritePacking)!;
    const pages=layout.pages.map(({width,height},index)=>({
      file:`${clip.id}/${request.layout==="loose"?"frame":"sheet"}-${String(index+1).padStart(5,"0")}.png`,
      width,height,columns:width/cell.width,rows:height/cell.height,clipId:clip.id,firstFrame:0,frameCount:0,
    }));
    for (const {page} of layout.placements) pages[page].frameCount++;
    let offset=0;
    for (const page of pages) { page.firstFrame=offset; offset+=page.frameCount; }
    return {pages,placements:layout.placements};
  });
  const planned=layouts.flatMap(layout=>layout.pages);
  const pixels=planned.reduce((total,page)=>total+page.width*page.height,0);
  if (pixels>fixedSpriteLimits.pixels) return {error:"atlas_too_large",status:400} as const;
  const header={
    schema:"kinetix.fixed-sprites",version:1,layout:request.layout,fps:request.fps,cell,
    source:{rigId,revision:request.revision,pixelScale},
    texture:{colorSpace:"srgb",alpha:"straight",filter:request.filter},textureBytes:pixels*4,
    clips,
  } as const;
  if (request.preflight) return {manifest:{...header,files:planned}} as const;

  const entries:Record<string,Uint8Array>={};
  const files=[];
  let encodedBytes=0;
  for (const [clipIndex,clip] of clips.entries()) {
    const {pages,placements}=layouts[clipIndex];
    const {snapshot,indices}=saved[clipIndex];
    const visible=new Set(clip.runs.filter(run=>run.frameCount>0).map(run=>run.frameId));
    const selected=clip.frames.flatMap((frame,index)=>visible.has(frame.id)?[{id:frame.id,index:indices[index]}]:[]);
    const crops=new Map<string,SpriteCrop>();
    let index=0;
    for (const frame of sampleRgbaFrames(snapshot,selected.map(frame=>frame.index))) {
      crops.set(selected[index++].id,cropSprite(frame.rgba,cell,false));
    }
    const output=clip.runs.flatMap(run=>Array.from({length:run.frameCount},()=>run.frameId));
    const loosePngs=new Map<string,Uint8Array>();
    for (const page of pages) {
      let png=loosePngs.get(output[page.firstFrame]);
      if (!png) {
        const target=new Uint8Array(page.width*page.height*4);
        for (let index=page.firstFrame;index<page.firstFrame+page.frameCount;index++) {
          blitSprite(target,page.width,crops.get(output[index])!,placements[index],0,"srgb","straight");
        }
        png=spritePng(page.width,page.height,target,"srgb");
        if (request.layout==="loose") loosePngs.set(output[page.firstFrame],png);
      }
      encodedBytes+=png.length;
      if (encodedBytes>fixedSpriteLimits.bytes) return {error:"package_too_large",status:400} as const;
      entries[page.file]=png;
      files.push({...page,bytes:png.length,sha256:createHash("sha256").update(png).digest("hex")});
    }
  }
  const manifest={...header,files};
  const timing=strToU8(JSON.stringify(manifest));
  if (encodedBytes+timing.length>fixedSpriteLimits.bytes) return {error:"package_too_large",status:400} as const;
  const bytes=zipSync({"timing.json":timing,...entries},{level:0,mtime:new Date(1980,0,1)});
  return bytes.length>fixedSpriteLimits.bytes ? {error:"package_too_large",status:400} as const : {manifest,bytes} as const;
}
