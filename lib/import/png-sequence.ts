import { unzipSync } from "fflate";
import { inflateSync } from "node:zlib";
import { PNG } from "pngjs";
import { z } from "zod";
import { editRig,type RigCommand } from "../rig/commands";
import type { CelRun } from "../rig/drawings";
import { artboardFor,type KinetixRigState } from "../rig/model";
import { maxSequenceBytes,maxSequenceFrames,type SequenceSummary } from "./sequence-options";

const pngSignature=Buffer.from([137,80,78,71,13,10,26,10]);
const maxUnpackedBytes=4*1024*1024;
const maxSamplePixels=32*1024*1024;
const passOffsets=[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]];
const fields={width:z.int().min(1).max(4096),height:z.int().min(1).max(4096),
  fps:z.int().min(1).max(120),startFrame:z.int().min(1).max(36000),endFrame:z.int().min(1).max(36000)};
const sequenceManifest=z.object({...fields,version:z.literal(1).optional()});

type Sample={file:string;sourceFrame:number;bytes:Uint8Array};
type Header={width:number;height:number;depth:number;channels:number;interlaced:boolean};

function archiveFiles(archive:Uint8Array) {
  if (!archive.length || archive.length>maxSequenceBytes) throw new Error("Choose a PNG sequence ZIP of 2 MiB or less.");
  const included=new Map<string,number>();
  const paths=new Set<string>();
  let unpacked=0;
  let count=0;
  const files=unzipSync(archive,{filter:entry=>{
    const path=entry.name;
    if (++count>256 || path.length>240 || /[\\:\u0000-\u001f]/.test(path) || path.startsWith("/") ||
      path.replace(/\/$/,"").split("/").some(part=>part==="." || part===".." || !part)) {
      throw new Error("This ZIP contains invalid paths or too many entries.");
    }
    if (paths.has(path.toLowerCase())) throw new Error("This ZIP contains duplicate file names.");
    paths.add(path.toLowerCase());
    if (path!=="sequence.json" && (!/\.png$/i.test(path) || path.startsWith("__MACOSX/"))) return false;
    unpacked+=entry.originalSize;
    if (included.size>=maxSequenceFrames+1 || unpacked>maxUnpackedBytes || entry.originalSize===0 ||
        (path==="sequence.json" && entry.originalSize>8192)) {
      throw new Error("The PNG sequence exceeds the file count or unpacked size limit.");
    }
    included.set(path,entry.originalSize);
    return true;
  }});
  for (const [name,size] of included) {
    if (files[name]?.length!==size) throw new Error("A ZIP entry has an invalid size.");
  }
  return files;
}

function samplesFor(files:Record<string,Uint8Array>,fallbackFps:number) {
  const images=Object.entries(files).filter(([name])=>name!=="sequence.json");
  if (!images.length || images.length>maxSequenceFrames) throw new Error("Select a sequence with 1 to 150 PNG frames.");
  if (files["sequence.json"]) {
    let data:unknown;
    try { data=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(files["sequence.json"])); }
    catch { throw new Error("The sequence.json manifest is invalid."); }
    const parsed=sequenceManifest.safeParse(data);
    if (!parsed.success) throw new Error("The sequence manifest needs valid dimensions, frame rate and first and last frames.");
    const {width,height,fps,startFrame,endFrame}=parsed.data;
    if (endFrame-startFrame+1!==images.length) throw new Error("The ZIP does not contain the frame range declared in sequence.json.");
    const samples:Sample[]=Array.from({length:images.length},(_,index)=>{
      const sourceFrame=startFrame+index;
      const file=`frames/${String(sourceFrame).padStart(5,"0")}.png`;
      if (!files[file]) throw new Error(`Frame ${sourceFrame} is missing from the sequence.`);
      return {file,sourceFrame,bytes:files[file]};
    });
    return {samples,fps,timing:"manifest" as const,expectedSize:{width,height}};
  }
  let prefix:string|undefined;
  const samples=images.map(([file,bytes],index)=>{
    const name=file.slice(file.lastIndexOf("/")+1);
    const number=/^(.*?)(\d{1,8})\.png$/i.exec(name);
    if (!number && images.length===1) return {file,sourceFrame:1,bytes};
    if (!number) throw new Error("Without sequence.json, give PNG files a shared name followed by a frame number.");
    if (index===0) prefix=number[1];
    const sourceFrame=Number(number[2]);
    if (number[1]!==prefix) throw new Error("Choose one consistently named frame sequence.");
    return {file,sourceFrame,bytes};
  }).sort((a,b)=>a.sourceFrame-b.sourceFrame);
  if (samples.some((sample,index)=>sample.sourceFrame!==samples[0].sourceFrame+index)) {
    throw new Error("Numbered PNG frames need consecutive and unique frame numbers.");
  }
  return {samples,fps:fallbackFps,timing:"numbered" as const,expectedSize:null};
}

function pngHeader(bytes:Uint8Array):Header {
  const header=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if (header.length<33 || !header.subarray(0,8).equals(pngSignature) || header.readUInt32BE(8)!==13 ||
      header.toString("ascii",12,16)!=="IHDR") throw new Error("Expected a valid PNG header.");
  const width=header.readUInt32BE(16);
  const height=header.readUInt32BE(20);
  const depth=bytes[24];
  const color=bytes[25];
  const channels=({0:1,2:3,3:1,4:2,6:4} as Record<number,number>)[color];
  const depths=color===0 ? [1,2,4,8,16] : color===3 ? [1,2,4,8] : [8,16];
  if (!width || !height || width>4096 || height>4096 || !channels || !depths.includes(depth) ||
      bytes[26]!==0 || bytes[27]!==0 || bytes[28]>1) throw new Error("PNG dimensions or pixel encoding exceed the supported profile.");
  return {width,height,depth,channels,interlaced:bytes[28]===1};
}

function decodePng(bytes:Uint8Array,header:Header,notes:Set<string>) {
  const buffer=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const data:Buffer[]=[];
  let ended=false;
  for (let offset=8;offset+12<=buffer.length;) {
    const size=buffer.readUInt32BE(offset);
    const type=buffer.toString("ascii",offset+4,offset+8);
    const end=offset+size+12;
    if (end>buffer.length) throw new Error("A PNG chunk is truncated.");
    if (type==="IHDR" && offset!==8) throw new Error("The PNG contains more than one image header.");
    if (type==="acTL") throw new Error("Choose individual PNG frames for animated PNG files.");
    if (type==="iCCP" || (type==="gAMA" && size===4 && buffer.readUInt32BE(offset+8)!==45455)) {
      notes.add("The import keeps RGB channel values and treats embedded color profiles as sRGB.");
    }
    if (type==="IDAT") data.push(buffer.subarray(offset+8,end-4));
    if (type==="IEND") {ended=end===buffer.length && size===0;break;}
    offset=end;
  }
  if (!ended || !data.length) throw new Error("The PNG is missing its image data or end marker.");
  // Bound the inflated stream before handing it to the PNG decoder, including Adam7 passes.
  const stride=(width:number)=>Math.ceil(width*header.channels*header.depth/8)+1;
  const limit=header.interlaced ? passOffsets.reduce((sum,[x,y,dx,dy])=>{
    const width=Math.ceil((header.width-x)/dx);
    const rows=Math.ceil((header.height-y)/dy);
    return sum+(width>0 && rows>0 ? stride(width)*rows : 0);
  },0) : stride(header.width)*header.height;
  if (inflateSync(Buffer.concat(data),{maxOutputLength:limit}).length!==limit) throw new Error("The PNG has the wrong pixel count.");
  const decoded=PNG.sync.read(buffer,{checkCRC:true});
  if (decoded.data.length!==header.width*header.height*4) throw new Error("The PNG has invalid RGBA data.");
  return decoded.data;
}

function readRuns(data:Buffer,width:number,height:number) {
  const runs:CelRun[]=[];
  for (let y=0;y<height;y++) {
    const row=y*width*4;
    let x=0;
    while (x<width) {
      const offset=row+4*x;
      if (!data[offset+3]) {x++;continue;}
      const ink=data.readUInt32BE(offset);
      const left=x++;
      while (x<width && data.readUInt32BE(row+4*x)===ink) x++;
      runs.push([y,left,x-left,ink]);
      if (runs.length>40_000) throw new Error("A frame exceeds the 40,000 pixel runs allowed for an editable cel.");
    }
  }
  return runs;
}

function previewImage(data:Buffer,width:number,height:number) {
  const scale=Math.min(1,160/width,120/height);
  const preview=new PNG({width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))});
  for (let y=0;y<preview.height;y++) for (let x=0;x<preview.width;x++) {
    const source=(Math.floor(y*height/preview.height)*width+Math.floor(x*width/preview.width))*4;
    data.copy(preview.data,(y*preview.width+x)*4,source,source+4);
  }
  return PNG.sync.write(preview).toString("base64");
}

export function planPngSequence(rig:KinetixRigState,archive:Uint8Array,options:{
  id:string;name:string;fps:number;resizeArtboard:boolean;preflight:boolean;
}) {
  let files:Record<string,Uint8Array>;
  try {files=archiveFiles(archive);}
  catch (error) {throw new Error(error instanceof Error ? `Could not read the sequence ZIP. ${error.message}` : "Could not read the sequence ZIP.");}
  const {samples,fps,timing,expectedSize}=samplesFor(files,options.fps);
  const {width,height}=pngHeader(samples[0].bytes);
  if ((expectedSize && (expectedSize.width!==width || expectedSize.height!==height)) ||
      samples.some(({bytes})=>{const header=pngHeader(bytes);return header.width!==width || header.height!==height;})) {
    throw new Error("Every frame must match the sequence dimensions.");
  }
  if (width*height*samples.length>maxSamplePixels) throw new Error("The sequence exceeds the decoded pixel budget. Import a shorter range or smaller frames.");
  const artboard=artboardFor(rig);
  const drawId=`sequence-${options.id}`;
  const commands:RigCommand[]=[];
  const notes=new Set<string>();
  if (options.resizeArtboard) {
    if (rig.version!==2 || rig.parts.length || rig.bones.length || rig.drawings?.layers.length) {
      throw new Error("Matching image dimensions requires an empty design artboard.");
    }
    commands.push({type:"artboard.update",artboard:{...artboard,width:Math.max(16,width),height:Math.max(16,height)}});
    if (width<16 || height<16) notes.add("The artboard uses the 16 px minimum on each side.");
  } else {
    if (width>artboard.width || height>artboard.height) throw new Error("The frames exceed this artboard. Use a larger artboard or match an empty design to the images.");
    if (width!==artboard.width || height!==artboard.height) notes.add("Frames are placed at the top-left at their original pixel size.");
  }
  commands.push({type:"drawing.create",drawing:{id:drawId,name:options.name,width,height,storage:{mode:"rgba"}}});
  let runCount=0;
  let celCount=0;
  let exposures=0;
  let blankFrames=0;
  let previous:string|undefined;
  let previewPng:string|undefined;
  for (const [frame,sample] of samples.entries()) {
    try {
      const png=decodePng(sample.bytes,pngHeader(sample.bytes),notes);
      const runs=readRuns(png,width,height);
      if (!runs.length) blankFrames++;
      if (options.preflight && !previewPng && runs.length) previewPng=previewImage(png,width,height);
      const signature=runs.length ? JSON.stringify(runs) : "";
      if (signature===previous) continue;
      previous=signature;
      let celId:string|null=null;
      if (runs.length) {
        runCount+=runs.length;
        if (runCount>100_000) throw new Error("The sequence exceeds the document's editable pixel run budget.");
        celId=`${drawId}-${++celCount}`;
        commands.push({type:"cel.create",drawingId:drawId,id:celId},{type:"cel.replace",drawingId:drawId,id:celId,runs});
      }
      commands.push({type:"exposure.set",drawingId:drawId,clipId:options.id,key:{frame,celId}});
      exposures++;
    } catch (error) {
      const message=error instanceof Error ? error.message : "Could not decode the image.";
      throw new Error(`Frame ${sample.sourceFrame} could not be imported. ${message}`);
    }
  }
  let state=rig;
  try {
    // The command limit applies per validated batch. Only the final candidate is persisted.
    for (let offset=0;offset<commands.length;offset+=100) [state]=editRig(state,commands.slice(offset,offset+100));
  } catch (error) {
    if (error instanceof z.ZodError) throw new Error("This import exceeds the available drawing, layer or pixel run capacity of the document.");
    throw error;
  }
  const summary:SequenceSummary={width,height,fps,timing,frameCount:samples.length,
    sourceStartFrame:samples[0].sourceFrame,sourceEndFrame:samples.at(-1)!.sourceFrame,
    celCount,exposureCount:exposures,heldFrames:samples.length-exposures,blankFrames,runCount,notes:[...notes]};
  return {state,summary,drawingId:drawId,previewPng};
}
