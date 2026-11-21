import { PNG } from "pngjs";
import { z } from "zod";
import { editRig,type RigCommand } from "../rig/commands";
import type { CelRun } from "../rig/drawings";
import { artboardFor,type KinetixRigState } from "../rig/model";

export const maxSamplePixels=32*1024*1024;

export function readRuns(data:Buffer,width:number,height:number,offsetX=0,offsetY=0) {
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
      runs.push([y+offsetY,left+offsetX,x-left,ink]);
      if (runs.length>40_000) throw new Error("A frame exceeds the 40,000 pixel runs allowed for an editable cel.");
    }
  }
  return runs;
}

export function previewImage(data:Buffer,width:number,height:number) {
  const scale=Math.min(1,160/width,120/height);
  const preview=new PNG({width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))});
  for (let y=0;y<preview.height;y++) for (let x=0;x<preview.width;x++) {
    const source=(Math.floor(y*height/preview.height)*width+Math.floor(x*width/preview.width))*4;
    data.copy(preview.data,(y*preview.width+x)*4,source,source+4);
  }
  return PNG.sync.write(preview).toString("base64");
}

export function prepareRasterArtboard(rig:KinetixRigState,width:number,height:number,resize:boolean,notes:Set<string>):RigCommand[] {
  const artboard=artboardFor(rig);
  if (resize) {
    if (rig.version!==2 || rig.parts.length || rig.bones.length || rig.drawings?.layers.length || rig.layers?.nodes.some(node=>node.kind==="image")) {
      throw new Error("Matching image dimensions requires an empty design artboard.");
    }
    if (width<16 || height<16) notes.add("The artboard uses the 16 px minimum on each side.");
    return [{type:"artboard.update",artboard:{...artboard,width:Math.max(16,width),height:Math.max(16,height)}}];
  }
  if (width>artboard.width || height>artboard.height) throw new Error("The frames exceed this artboard. Use a larger artboard or match an empty design to the images.");
  if (width!==artboard.width || height!==artboard.height) notes.add("Frames are placed at the top-left at their original pixel size.");
  return [];
}

export function applyRasterCommands(state:KinetixRigState,commands:RigCommand[]) {
  try {
    // Each edit batch is bounded. The import service persists only the final candidate.
    for (let offset=0;offset<commands.length;offset+=100) [state]=editRig(state,commands.slice(offset,offset+100));
  } catch (error) {
    if (error instanceof z.ZodError) throw new Error("This import exceeds the available drawing, layer or pixel run capacity of the document.");
    throw error;
  }
  return state;
}
