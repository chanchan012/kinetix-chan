import { z } from "zod";
import { rgbaInk, type CelRun, type Drawing } from "./drawings";

const inkSchema = z.int().min(1).max(0xffffffff);
const coord = z.int().min(0).max(4095);
const length = z.int().min(1).max(4096);
const unit = z.number().min(0).max(1);
export const strokeSampleSchema = z.strictObject({
  x:z.number().min(-8192).max(8192),
  y:z.number().min(-8192).max(8192),
  pressure:unit,
});
export const pixelOperationSchema = z.discriminatedUnion("kind",[
  z.strictObject({
    kind:z.literal("stroke"),tool:z.enum(["pencil","brush","eraser"]),
    ink:inkSchema,size:z.number().min(1).max(128),opacity:unit,stabilization:z.number().min(0).max(0.9),
    symmetry:z.enum(["none","horizontal","vertical","both"]),
    points:z.array(strokeSampleSchema).min(1).max(2048),
  }),
  z.strictObject({kind:z.literal("fill"),x:coord,y:coord,ink:inkSchema,tolerance:z.int().min(0).max(255)}),
  z.strictObject({
    kind:z.literal("transform"),
    region:z.strictObject({x:coord,y:coord,width:length,height:length}),
    offsetX:z.int().min(-4096).max(4096),offsetY:z.int().min(-4096).max(4096),
    rotation:z.enum(["0","90","180","270"]),flipX:z.boolean(),flipY:z.boolean(),scale:z.int().min(1).max(4),
  }),
]);
export type StrokeSample = z.infer<typeof strokeSampleSchema>;
export type PixelOperation = z.infer<typeof pixelOperationSchema>;
export type CelStroke = Extract<PixelOperation,{kind:"stroke"}>;

function decode(width:number,height:number,runs:readonly CelRun[]) {
  const pixels = new Uint32Array(width*height);
  for (const [row,left,length,ink] of runs) pixels.fill(ink,row*width+left,row*width+left+length);
  return pixels;
}

function encode(width:number,height:number,pixels:Uint32Array) {
  const runs:CelRun[] = [];
  for (let y=0;y<height;y++) {
    const row = y*width;
    for (let x=0;x<width;) {
      const ink=pixels[row+x];
      const left=x++;
      if (!ink) continue;
      while (x<width && pixels[row+x]===ink) x++;
      runs.push([y,left,x-left,ink]);
      if (runs.length>40_000) throw new Error("This edit exceeds the cel limit of 40,000 pixel runs.");
    }
  }
  return runs;
}

function packedAlpha(ink:number,alpha:number):number {
  return alpha>0 ? Math.floor(ink/256)*256+alpha : 0;
}

function composite(base:number,ink:number,coverage:number,indexed:boolean):number {
  const src = (ink&255)*coverage/255;
  const retained = (base&255)*(1-src/255);
  const total = src+retained;
  if (!src) return base;
  if (indexed || !retained) return packedAlpha(ink,Math.round(total));
  const mix = (shift:number) => Math.round((((ink >>> shift)&255)*src+((base >>> shift)&255)*retained)/total);
  return (mix(24)*65536+mix(16)*256+mix(8))*256+Math.round(total);
}

function applyStroke(pixels:Uint32Array,drawing:Drawing,op:CelStroke) {
  const {width,height}=drawing;
  const coverage=new Uint8Array(pixels.length);
  let budget=32_000_000;
  const mirrorX=op.symmetry==="horizontal" || op.symmetry==="both";
  const mirrorY=op.symmetry==="vertical" || op.symmetry==="both";
  function mark(x:number,y:number,amount:number) {
    if (x<0 || x>=width || y<0 || y>=height) return;
    function record(px:number,py:number) {
      const index=py*width+px;
      if (coverage[index]<amount) coverage[index]=amount;
    }
    record(x,y);
    if (mirrorX) record(width-1-x,y);
    if (mirrorY) record(x,height-1-y);
    if (mirrorX && mirrorY) record(width-1-x,height-1-y);
  }
  function stamp(point:StrokeSample) {
    const {x,y,pressure}=point;
    const strength = op.opacity*(op.tool==="pencil" ? 1 : pressure)*255;
    if (strength<0.5) return;
    if (op.tool==="pencil" && op.size===1) {
      mark(Math.floor(x),Math.floor(y),Math.round(strength));
      return;
    }
    const radius = Math.max(0.5,op.size*(op.tool==="pencil" ? 1 : 0.2+0.8*pressure)/2);
    const left=Math.max(0,Math.floor(x-radius-0.5));
    const right=Math.min(width-1,Math.floor(x+radius+0.5));
    const top=Math.max(0,Math.floor(y-radius-0.5));
    const bottom=Math.min(height-1,Math.floor(y+radius+0.5));
    const area=Math.max(0,right-left+1)*Math.max(0,bottom-top+1);
    budget-=area;
    if (budget<0) throw new Error("The stroke is too large. Lift the pen and continue with another stroke.");
    for (let py=top;py<=bottom;py++) for (let px=left;px<=right;px++) {
      const distance=Math.hypot(px+0.5-x,py+0.5-y);
      const edge=op.tool==="pencil" ? Number(distance<=radius) : Math.min(1,Math.max(0,radius+0.5-distance));
      mark(px,py,Math.round(strength*edge));
    }
  }
  let previous=op.points[0];
  stamp(previous);
  for (const [index,point] of op.points.entries()) {
    if (index===0) continue;
    const strength = index===op.points.length-1 ? 1 : 1-op.stabilization;
    const dx=(point.x-previous.x)*strength;
    const dy=(point.y-previous.y)*strength;
    const steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/Math.max(0.5,op.size*0.08)));
    budget-=steps;
    if (budget<0) throw new Error("The stroke is too large. Lift the pen and continue with another stroke.");
    for (let step=1;step<=steps;step++) {
      const t=step/steps;
      stamp({x:previous.x+dx*t,y:previous.y+dy*t,pressure:previous.pressure+(point.pressure-previous.pressure)*t});
    }
    previous={x:previous.x+dx,y:previous.y+dy,pressure:point.pressure};
  }
  for (let i=0;i<pixels.length;i++) {
    if (!coverage[i]) continue;
    if (op.tool==="eraser") {
      pixels[i]=packedAlpha(pixels[i],Math.round((pixels[i]&255)*(1-coverage[i]/255)));
    } else pixels[i]=composite(pixels[i],op.ink,coverage[i],drawing.storage.mode==="indexed");
  }
}

function flood(pixels:Uint32Array,drawing:Drawing,op:Extract<PixelOperation,{kind:"fill"}>) {
  const {width,height}=drawing;
  if (op.x>=width || op.y>=height) return;
  const start=op.y*width+op.x;
  if (pixels[start]===op.ink) return;
  const reference=rgbaInk(drawing.storage,pixels[start]);
  const colors=drawing.storage.mode==="indexed" ? drawing.storage.colors.map(color=>Number.parseInt(color.slice(1),16)) : null;
  const components = [24,16,8,0];
  const visited=new Uint8Array(pixels.length);
  const stack=[start];
  function matches(index:number) {
    if (visited[index]) return false;
    const ink=pixels[index];
    const value=ink && colors ? colors[ink>>>8]*256+(ink&255) : ink;
    for (const shift of components) {
      if (Math.abs(((value >>> shift)&255)-((reference >>> shift)&255))>op.tolerance) return false;
    }
    return true;
  }
  while (stack.length) {
    let start=stack.pop()!;
    if (!matches(start)) continue;
    const row=Math.floor(start/width)*width;
    while (start>row && matches(start-1)) start--;
    let above=false;
    let below=false;
    for (let i=start;i<row+width && matches(i);i++) {
      visited[i]=1;
      pixels[i]=op.ink;
      const up=row>0 && matches(i-width);
      const down=row+width<width*height && matches(i+width);
      if (up && !above) stack.push(i-width);
      if (down && !below) stack.push(i+width);
      above=up;
      below=down;
    }
  }
}

function transform(pixels:Uint32Array,drawing:Drawing,op:Extract<PixelOperation,{kind:"transform"}>) {
  const {width,height}=drawing;
  const r=op.region;
  if (r.x+r.width>width || r.y+r.height>height) throw new Error("The pixel selection crosses the drawing bounds.");
  const temp=new Uint32Array(r.width*r.height);
  for (let y=0;y<r.height;y++) {
    const start=(r.y+y)*width+r.x;
    temp.set(pixels.subarray(start,start+r.width),y*r.width);
    pixels.fill(0,start,start+r.width);
  }
  for (let y=0;y<r.height;y++) for (let x=0;x<r.width;x++) {
    const ink=temp[y*r.width+x];
    if (!ink) continue;
    const sx=op.flipX ? r.width-1-x : x;
    const sy=op.flipY ? r.height-1-y : y;
    const [rx,ry]=op.rotation==="90" ? [r.height-1-sy,sx] :
      op.rotation==="180" ? [r.width-1-sx,r.height-1-sy] :
        op.rotation==="270" ? [sy,r.width-1-sx] : [sx,sy];
    const dx=r.x+op.offsetX+rx*op.scale;
    const dy=r.y+op.offsetY+ry*op.scale;
    const left=Math.max(0,dx);
    const right=Math.min(width,dx+op.scale);
    for (let row=Math.max(0,dy);row<Math.min(height,dy+op.scale);row++) {
      for (let column=left;column<right;column++) {
        const i=row*width+column;
        pixels[i]=composite(pixels[i],ink,255,drawing.storage.mode==="indexed");
      }
    }
  }
}

export function editCelPixels(drawing:Drawing,runs:readonly CelRun[],op:PixelOperation):CelRun[] {
  if ("ink" in op && (op.ink%256===0 ||
      (drawing.storage.mode==="indexed" && Math.floor(op.ink/256)>=drawing.storage.colors.length))) {
    throw new Error("Choose a visible ink available in the drawing palette.");
  }
  const pixels=decode(drawing.width,drawing.height,runs);
  if (op.kind==="stroke") applyStroke(pixels,drawing,op);
  else if (op.kind==="fill") flood(pixels,drawing,op);
  else transform(pixels,drawing,op);
  return encode(drawing.width,drawing.height,pixels);
}
