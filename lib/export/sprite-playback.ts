import { strFromU8, unzlibSync, unzipSync } from "fflate";
import { z } from "zod";
import { spriteCompanionFields,spriteLoopMode } from "../rig/sprite-sources";

const texLimit=16*1024*1024;
const fileLimit=1_500_000;
const size=z.int().min(1).max(8192);
const offset=z.int().min(0).max(8192);
const frameSize=z.object({width:size,height:size});
const fileName=z.string().regex(/^(atlas\/[0-9]{3}|frames\/[0-9]{5})\.png$/);
const label=z.string().min(1).max(80);
const frame=z.object({
  id:z.string().min(1).max(80),sourceFrame:z.int().min(0).max(35_999),file:fileName,
  ...spriteCompanionFields,
  rect:frameSize.extend({x:offset,y:offset}),sourceSize:frameSize,trimOffset:z.object({x:offset,y:offset}),
  blank:z.boolean(),rotation:z.union([z.literal(0),z.literal(90)]),
});
const clip=z.object({
  id:z.uuid(),name:z.string().min(1).max(120),direction:label.optional(),
  trackRevision:z.int().min(0),startFrame:z.int().min(0).max(35_999),endFrame:z.int().min(0).max(35_999),
  loopMode:spriteLoopMode,ticksPerSecond:z.int().min(1).max(120),
  durationTicks:z.int().min(1).max(960_000),frames:z.array(frame).min(1).max(96),
});
export const spriteBundleManifest=z.object({
  schema:z.literal("kinetix.sprite-package"),version:z.literal(2),layout:z.enum(["loose","fixed-grid","packed"]),
  source:z.object({rigId:z.uuid(),revision:z.int().min(0),pixelScale:z.int().min(1).max(4)}),
  texture:z.object({filter:z.enum(["nearest","linear"]),alpha:z.enum(["straight","premultiplied"]),
    colorSpace:z.enum(["srgb","linear"]),maxSize:z.int().min(16).max(8192),
    padding:z.int().min(0).max(16),extrusion:z.int().min(0).max(8),trim:z.boolean(),rotate:z.boolean()}),
  textureBytes:z.int().min(4).max(texLimit*4),
  clips:z.array(clip).min(1).max(16),
  files:z.array(frameSize.extend({file:fileName,sha256:z.string().regex(/^[a-f0-9]{64}$/),
    bytes:z.int().min(1).max(fileLimit)})).min(1).max(96),
}).superRefine((manifest,context)=>{
  const pages=new Map(manifest.files.map(page=>[page.file,page]));
  const totalFrames=manifest.clips.reduce((count,clip)=>count+clip.frames.length,0);
  const texels=manifest.files.reduce((count,file)=>count+file.width*file.height,0);
  if (texels>texLimit || manifest.textureBytes!==texels*4 || totalFrames>96 || pages.size!==manifest.files.length ||
      manifest.files.some(file=>file.width>manifest.texture.maxSize || file.height>manifest.texture.maxSize ||
        !file.file.startsWith(manifest.layout==="loose" ? "frames/" : "atlas/")) ||
      new Set(manifest.clips.map(clip=>clip.id)).size!==manifest.clips.length) {
    context.addIssue({code:"custom",message:"Sprite bundle exceeds the player limits or uses duplicate IDs."});
    return;
  }
  for (const clip of manifest.clips) {
    let expectedTick=0;
    let sourceFrame=clip.startFrame;
    for (const entry of clip.frames) {
      const page=pages.get(entry.file);
      const {rect,rotation,sourceSize,trimOffset}=entry;
      const width=rotation===90 ? rect.height : rect.width;
      const height=rotation===90 ? rect.width : rect.height;
      if (!page || rect.x+rect.width>page.width || rect.y+rect.height>page.height ||
          trimOffset.x+width>sourceSize.width || trimOffset.y+height>sourceSize.height ||
          entry.startTick!==expectedTick || entry.sourceFrame!==sourceFrame ||
          entry.id!==clip.id+":"+sourceFrame || (!manifest.texture.rotate && rotation!==0) ||
          entry.events.some(event=>event.tick>=entry.durationTicks)) {
        context.addIssue({code:"custom",message:"A frame has invalid texture bounds or timing."});
        return;
      }
      expectedTick+=entry.durationTicks;
      sourceFrame++;
    }
    if (expectedTick!==clip.durationTicks || sourceFrame!==clip.endFrame+1) {
      context.addIssue({code:"custom",message:"The clip duration or source range does not match its frames."});
    }
  }
});
export type PlaybackManifest=z.infer<typeof spriteBundleManifest>;
export type PlaybackFrame=z.infer<typeof frame>;
export type PlaybackClip=z.infer<typeof clip>;
type SpriteBitmap={width:number;height:number;rgba:Uint8Array};

/** Decode the lossless, 8-bit RGBA PNG profile emitted by the v2 sprite exporter. */
export function readSpritePng(bytes:Uint8Array,{width,height}:{width:number;height:number}):SpriteBitmap {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const png=bytes.length>=33 && view.getUint32(0)===0x89504e47 && view.getUint32(4)===0x0d0a1a0a;
  if (!png || view.getUint32(8)!==13 || view.getUint32(12)!==0x49484452 || view.getUint32(16)!==width ||
      view.getUint32(20)!==height || bytes[24]!==8 || bytes[25]!==6 || bytes[26] || bytes[27] || bytes[28]) {
    throw new Error("The PNG dimensions or encoding do not match the sprite profile.");
  }
  const IDAT=0x49444154;
  const payloads:Uint8Array[]=[];
  let total=0;
  for (let i=8;i+12<=bytes.length;) {
    const length=view.getUint32(i);
    if (i+12+length>bytes.length) throw new Error("A texture PNG is truncated.");
    if (view.getUint32(i+4)===IDAT) {
      const payload=bytes.subarray(i+8,i+8+length);
      payloads.push(payload);
      total+=length;
    }
    i+=length+12;
  }
  if (!total) throw new Error("A texture PNG has no image data.");
  const payload=new Uint8Array(total);
  let next=0;
  for (const data of payloads) {
    payload.set(data,next);
    next+=data.length;
  }
  const stride=width*4;
  const scanlines=unzlibSync(payload,{out:new Uint8Array((stride+1)*height+1)});
  if (scanlines.length!==(stride+1)*height) throw new Error("The texture PNG has the wrong pixel count.");
  const rgba=new Uint8Array(stride*height);
  for (let y=0;y<height;y++) {
    const row=y*(stride+1);
    const target=y*stride;
    const filter=scanlines[row];
    if (filter!==0 && filter!==1) throw new Error("The texture uses an unsupported PNG row filter.");
    for (let i=0;i<stride;i++) {
      rgba[target+i]=scanlines[row+1+i]+(filter===1 && i>=4 ? rgba[target+i-4] : 0);
    }
  }
  return {width,height,rgba};
}

export async function openSpriteBundle(bytes:Uint8Array) {
  if (bytes.byteLength>fileLimit) throw new Error("This sprite ZIP exceeds the player size limit.");
  let total=0;
  const seen=new Set<string>();
  const files=unzipSync(bytes,{filter:entry=>{
    if (entry.name!=="kinetix.json" && !fileName.safeParse(entry.name).success) return false;
    if (seen.has(entry.name) || seen.size>=97) throw new Error("The sprite bundle has duplicate or excess files.");
    seen.add(entry.name);
    total+=entry.originalSize;
    if (total>fileLimit) throw new Error("Unpacked sprite data exceeds the player size limit.");
    return true;
  }});
  if (!files["kinetix.json"]) throw new Error("This ZIP has no Kinetix manifest.");
  const parsed=spriteBundleManifest.safeParse(JSON.parse(strFromU8(files["kinetix.json"])));
  if (!parsed.success) throw new Error("Choose a valid version 2 portable sprite bundle.");
  const manifest=parsed.data;
  if (seen.size!==manifest.files.length+1) throw new Error("The sprite bundle contains undeclared texture files.");
  const textures=new Map<string,SpriteBitmap>();
  for (const page of manifest.files) {
    const png=files[page.file];
    if (!png || png.length!==page.bytes) throw new Error("The bundle is missing "+page.file+".");
    const hash=await crypto.subtle.digest("SHA-256",Uint8Array.from(png));
    const digest=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,"0")).join("");
    if (digest!==page.sha256) throw new Error("The texture checksum does not match "+page.file+".");
    textures.set(page.file,readSpritePng(png,page));
  }
  return {manifest,textures};
}

/** Repeat whole authored holds and ping-pong through the interior frames. */
export function frameAtTick(clip:PlaybackClip,tick:number) {
  const timeline=Math.max(0,Math.floor(tick));
  if (clip.loopMode==="once") return frameInForward(clip,Math.min(timeline,clip.durationTicks-1));
  if (clip.loopMode==="repeat" || clip.frames.length<3) return frameInForward(clip,timeline%clip.durationTicks);
  const first=clip.frames[0];
  const last=clip.frames.at(-1)!;
  const reverse=clip.durationTicks-first.durationTicks-last.durationTicks;
  const time=timeline%(clip.durationTicks+reverse);
  if (time<clip.durationTicks) return frameInForward(clip,time);
  return frameInForward(clip,last.startTick-1-(time-clip.durationTicks));
}

export function forwardFrameStart(clip:PlaybackClip,index:number) {
  return clip.frames[Math.max(0,Math.min(index,clip.frames.length-1))].startTick;
}

function frameInForward(clip:PlaybackClip,tick:number) {
  return clip.frames.findLast(entry=>entry.startTick<=tick) ?? clip.frames[0];
}

const srgb=Uint8Array.from({length:256},(_,value)=>{
  const n=value/255;
  return Math.round(255*(n<=0.0031308 ? n*12.92 : 1.055*n**(1/2.4)-0.055));
});

/** Isolate the frame before sampling so a fractional draw never reaches a neighboring sprite. */
export function restoreSpritePixels(texture:SpriteBitmap,frame:PlaybackFrame,settings:PlaybackManifest["texture"]) {
  const rotated=frame.rotation===90;
  const width=rotated ? frame.rect.height : frame.rect.width;
  const height=rotated ? frame.rect.width : frame.rect.height;
  const pixels=new Uint8ClampedArray(width*height*4);
  if (frame.blank) return {width,height,pixels};
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const storedX=frame.rect.x+(rotated ? height-1-y : x);
    const storedY=frame.rect.y+(rotated ? x : y);
    const from=(storedY*texture.width+storedX)*4;
    const to=(y*width+x)*4;
    const alpha=texture.rgba[from+3];
    pixels[to+3]=alpha;
    for (let channel=0;channel<3;channel++) {
      const value=texture.rgba[from+channel];
      const straight=settings.alpha==="premultiplied" ? (alpha ? Math.min(255,Math.round(value*255/alpha)) : 0) : value;
      pixels[to+channel]=settings.colorSpace==="linear" ? srgb[straight] : straight;
    }
  }
  return {width,height,pixels};
}

export function spriteDrawOrigin(frame:PlaybackFrame,x:number,y:number,zoom:number) {
  return {x:x+(frame.trimOffset.x-frame.pivot.x)*zoom,y:y+(frame.trimOffset.y-frame.pivot.y)*zoom};
}

/** Give trimmed and untrimmed layouts the same transparent edge when sampling. */
export function createSpriteCanvas(crop: ReturnType<typeof restoreSpritePixels> | undefined) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare a sprite texture canvas.");
  if (!crop) return { canvas, x: 0, y: 0 };

  const { width, height, pixels } = crop;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pixels[(y * width + x) * 4 + 3]) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) return { canvas, x: 0, y: 0 };

  const cropWidth = right - left + 1;
  canvas.width = cropWidth + 2;
  canvas.height = bottom - top + 3;
  const guarded = context.createImageData(canvas.width, canvas.height);
  for (let y = top; y <= bottom; y++) {
    const from = (y * width + left) * 4;
    const to = ((y - top + 1) * canvas.width + 1) * 4;
    guarded.data.set(pixels.subarray(from, from + cropWidth * 4), to);
  }
  context.putImageData(guarded, 0, 0);
  return { canvas, x: left - 1, y: top - 1 };
}

export function spriteCropIdentity(frame: PlaybackFrame) {
  if (frame.blank) return "blank";
  const { x, y, width, height } = frame.rect;
  return JSON.stringify([frame.file, x, y, width, height, frame.rotation]);
}

export type SpriteCue = { clipId: string; frameId: string; cue: PlaybackFrame["events"][number] };

export function compileSpriteTimeline(clip: PlaybackClip) {
  const visits = [...clip.frames];
  if (clip.loopMode === "ping-pong") visits.push(...clip.frames.slice(1, -1).reverse());
  let period = 0;
  const cues = visits.flatMap(frame => {
    const start = period;
    period += frame.durationTicks;
    return frame.events.toSorted((a, b) => a.tick - b.tick).map(cue => ({
      tick: start + cue.tick,
      event: { clipId: clip.id, frameId: frame.id, cue },
    }));
  });
  return { period, cues, repeats: clip.loopMode !== "once" };
}

export function* spriteCuesBetween(timeline: ReturnType<typeof compileSpriteTimeline>, from: number, to: number) {
  if (!timeline.cues.length) return;
  const firstLoop = Math.floor(Math.max(0, from) / timeline.period);
  const lastLoop = timeline.repeats ? Math.floor(to / timeline.period) : 0;
  for (let loop = firstLoop; loop <= lastLoop; loop++) {
    const start = loop * timeline.period;
    for (const { tick, event } of timeline.cues) {
      const absoluteTick = start + tick;
      if (absoluteTick > to) break;
      if (absoluteTick > from) yield { tick: absoluteTick, event };
    }
  }
}
