import { applyPatches } from "immer";
import { describe, expect, it } from "vitest";
import { editRig, type RigCommand } from "../../lib/rig/commands";
import { celAt, exposureAt, inkAt, rgbaInk } from "../../lib/rig/drawings";
import { createBlankRig, readRigState } from "../../lib/rig/model";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { strFromU8, unzipSync } from "fflate";
import { compileLottie } from "../../lib/export/lottie";
import { containsRasterCels } from "../../lib/export/frames";
import { renderPngSequence } from "../../lib/export/raster";
import { prepareSpritePackage } from "../../lib/export/sprite-package";
import { spritePackageRequest } from "../../lib/export/sprite-package-options";
import type { CelStroke, PixelOperation } from "../../lib/rig/cel-tools";

const clipId = "b106de28-06f0-43c9-a4ad-10def4b7b94f";
const artboard = () => createBlankRig({name:"Lantern",width:32,height:32,background:null});
const id = "flame";
const setup:RigCommand[] = [
  {type:"drawing.create",drawing:{
    id,name:"Flame",width:32,height:32,storage:{mode:"indexed",colors:["#ff9500","#fff2a0"]},
  }},
  {type:"cel.create",drawingId:id,id:"base"},
  {type:"cel.replace",drawingId:id,id:"base",runs:[[12,10,2,255],[13,9,3,511]]},
  {type:"drawing.rest",id,celId:"base"},
];

describe("drawn cel and exposure commands",()=>{
  it("samples held, linked, blank and copied cels independently across clips",()=>{
    const [created] = editRig(artboard(),[
      ...setup,
      {type:"cel.create",drawingId:id,id:"independent",sourceId:"base"},
      {type:"exposure.set",drawingId:id,clipId,key:{frame:2,celId:"base"}},
      {type:"exposure.set",drawingId:id,clipId,key:{frame:5,celId:"base"}},
      {type:"exposure.set",drawingId:id,clipId,key:{frame:7,celId:null}},
      {type:"exposure.set",drawingId:id,clipId,key:{frame:9,celId:"independent"}},
      {type:"cel.replace",drawingId:id,id:"independent",runs:[[12,14,1,511]]},
    ]);
    const rig = readRigState(JSON.parse(JSON.stringify(created)));
    const layer = rig.drawings!.layers[0];
    expect([0,2,4,5,6,7,8,9,15].map(frame=>exposureAt(layer,{clipId,frame}))).toEqual([
      "base","base","base","base","base",null,null,"independent","independent",
    ]);
    expect(celAt(layer,{clipId,frame:7})).toBeUndefined();
    expect(celAt(layer,{frame:7})?.id).toBe("base");
    expect(inkAt(celAt(layer,{clipId,frame:5})!.runs,10,12)).toBe(255);
    expect(inkAt(celAt(layer,{clipId,frame:9})!.runs,10,12)).toBe(0);
    expect(inkAt(celAt(layer,{clipId,frame:9})!.runs,14,12)).toBe(511);
  });

  it("recolors indexed cels, leaves source pixels stable, and restores the operation with undo",()=>{
    const [before] = editRig(artboard(),setup);
    const [next,,inverse] = editRig(before,[{type:"drawing.palette",id,colors:["#33f4f1","#006699"]}]);
    const drawing = next.drawings!.layers[0];
    expect(drawing.cels).toEqual(before.drawings!.layers[0].cels);
    expect(rgbaInk(drawing.storage,inkAt(drawing.cels[0].runs,10,12))).toBe(0x33f4f1ff);
    expect(applyPatches(next,inverse)).toEqual(before);
  });

  it("validates canonical runs and atomic reference edits even for batched commands",()=>{
    const [before] = editRig(artboard(),setup);
    for (const runs of [
      [[12,30,3,255]],[[2,9,2,255],[2,10,2,511]],[[2,9,1,255],[2,10,1,255]],
      [[1,1,1,256]],[[1,1,1,767]],[[3,1,1,255],[2,1,1,255]],
    ] as const) {
      expect(()=>editRig(before,[{type:"cel.replace",drawingId:id,id:"base",runs:runs.map(run=>[...run])}])).toThrow();
    }
    expect(()=>editRig(before,[{type:"cel.remove",drawingId:id,id:"base"}])).toThrow("Unlink");
    expect(()=>editRig(before,[
      {type:"drawing.rest",id,celId:null},
      {type:"cel.remove",drawingId:id,id:"base"},
      {type:"exposure.set",drawingId:id,clipId,key:{frame:2,celId:"missing"}},
    ])).toThrow();
    expect(before.drawings?.layers[0].restCelId).toBe("base");
  });

  it("preserves layer stacking, lock inheritance, and independent group duplication",()=>{
    const [before] = editRig(artboard(),[
      ...setup,
      {type:"layer.group",id:"scene",name:"Scene",members:[id]},
      {type:"layer.flags",id:"scene",locked:true},
    ]);
    expect(()=>editRig(before,[{type:"cel.replace",drawingId:id,id:"base",runs:[]}])).toThrow("Unlock");
    const [copy] = editRig(before,[
      {type:"layer.duplicate",id:"scene",prefix:"copy"},
      {type:"layer.flags",id:"copy-0",locked:false},
      {type:"cel.replace",drawingId:"copy-1",id:"base",runs:[]},
    ]);
    expect(copy.drawings!.layers.map(layer=>[layer.id,layer.cels[0].runs.length])).toEqual([[id,2],["copy-1",0]]);
    expect(copy.layers?.nodes.find(node=>node.id==="copy-1")).toMatchObject({parentId:"copy-0",drawingId:"copy-1"});
  });

  it("applies pencil symmetry, pressure, erasure, flood boundaries, and a nearest-pixel transform",()=>{
    const color=0xff9500ff;
    const [start] = editRig(artboard(),[
      {type:"drawing.create",drawing:{id,name:"Truecolor",width:32,height:32,storage:{mode:"rgba"}}},
      {type:"cel.create",drawingId:id,id:"cel"},
    ]);
    const command=(operation:PixelOperation):RigCommand=>({type:"cel.edit",drawingId:id,id:"cel",operation});
    const stroke:CelStroke={kind:"stroke",tool:"pencil",ink:color,size:1,opacity:1,stabilization:0,symmetry:"horizontal",
      points:[{x:2.5,y:3.5,pressure:1},{x:5.5,y:3.5,pressure:1}]};
    const [pencil] = editRig(start,[command(stroke)]);
    const at=(rig:typeof pencil,x:number,y:number)=>inkAt(rig.drawings!.layers[0].cels[0].runs,x,y);
    expect([2,3,4,5,6,25,26,27,28,29].map(x=>at(pencil,x,3))).toEqual([
      color,color,color,color,0,0,color,color,color,color,
    ]);
    const [pressure] = editRig(pencil,[
      command({...stroke,tool:"brush",symmetry:"none",size:7,points:[{x:8.5,y:8.5,pressure:0.3}]}),
      command({...stroke,tool:"brush",symmetry:"none",size:7,points:[{x:19.5,y:8.5,pressure:1}]}),
    ]);
    expect(at(pressure,8,8)&255).toBe(77);
    expect(at(pressure,19,8)&255).toBe(255);
    expect(at(pressure,21,8)).not.toBe(0);
    expect(at(pressure,10,8)&255).toBeLessThan(77);
    expect(at(pressure,11,8)).toBe(0);
    const [erased] = editRig(pressure,[command({...stroke,tool:"eraser",symmetry:"none",size:2,
      points:[{x:19.5,y:8.5,pressure:1}]} )]);
    expect(at(erased,19,8)).toBe(0);
    const [flooded] = editRig(pencil,[command({kind:"fill",x:3,y:3,ink:0x4433ffff,tolerance:0})]);
    expect(at(flooded,2,3)).toBe(0x4433ffff);
    expect(at(flooded,29,3)).toBe(color);
    const [transformed] = editRig(flooded,[command({kind:"transform",region:{x:2,y:3,width:4,height:1},
      offsetX:5,offsetY:5,rotation:"90",flipX:false,flipY:false,scale:2})]);
    expect(at(transformed,2,3)).toBe(0);
    expect(at(transformed,7,8)).toBe(0x4433ffff);
    expect(at(transformed,8,15)).toBe(0x4433ffff);
    expect(at(transformed,9,15)).toBe(0);
  });

  it("delivers six poses, unequal holds and an explicit blank at 1× and 3×",async ()=>{
    const transitions = [0,2,5,8,12,14];
    const commands:RigCommand[] = transitions.flatMap((frame,index)=>{
      const celId="pose-"+index;
      return [
        {type:"cel.create",drawingId:id,id:celId},
        {type:"cel.replace",drawingId:id,id:celId,runs:[[11,6+index,1,511],[12,5+index,2,255]]},
        {type:"exposure.set",drawingId:id,clipId,key:{frame,celId}},
      ];
    });
    const [rig] = editRig(artboard(),[
      ...setup,...commands,{type:"exposure.set",drawingId:id,clipId,key:{frame:11,celId:null}},
    ]);
    const snapshot = {rig,clipId,name:"Flame",fps:12,frameCount:16,startFrame:0,endFrame:15,tracks:[]};
    expect(containsRasterCels(snapshot)).toBe(true);
    expect(containsRasterCels({...snapshot,startFrame:11,endFrame:11})).toBe(false);
    expect(()=>compileLottie(snapshot)).toThrow("Raster cels require");
    expect(compileLottie({...snapshot,startFrame:11,endFrame:11}).layers).toEqual([]);

    const queue = {inputs:async()=>({rigId:"test",name:"Lantern",state:rig,revision:4,
      clip:{id:clipId,name:"Flame",fps:12,frameCount:16,trackRevision:0,tracks:[]}})};
    const spans = [0,0,1,1,1,2,2,2,3,3,3,-1,4,4,5,5];
    for (const scale of [1,3]) {
      const pngs = unzipSync(renderPngSequence({...snapshot,scale}));
      expect(JSON.parse(strFromU8(pngs["sequence.json"]))).toMatchObject({width:32*scale,height:32*scale,fps:12});
      const request = spritePackageRequest.parse({clipId,revision:4,trackRevision:0,startFrame:0,endFrame:15,
        pivot:{x:9,y:14},scale});
      const packed = await prepareSpritePackage(queue,"owner","test",request);
      if ("error" in packed || !packed.bytes) throw new Error("The fixture sprite package failed");
      const archive = unzipSync(packed.bytes);
      const atlas = await loadImage(archive["atlas.png"]);
      const context = createCanvas(atlas.width,atlas.height).getContext("2d");
      context.drawImage(atlas,0,0);
      for (const [index,frame] of packed.manifest.frames.entries()) {
        expect([frame.sourceFrame,frame.durationTicks,frame.pivot.x,frame.pivot.y]).toEqual([index,1,9*scale,14*scale]);
        const {x,y,width,height} = frame.rect;
        const loose = await loadImage(pngs["frames/"+String(index+1).padStart(5,"0")+".png"]);
        const pixels = createCanvas(width,height).getContext("2d");
        pixels.drawImage(loose,0,0);
        expect(context.getImageData(x,y,width,height).data).toEqual(pixels.getImageData(0,0,width,height).data);
        const pose = spans[index];
        const left = pose>=0 ? (6+pose)*scale : 6*scale;
        const block = context.getImageData(x+left,y+11*scale,scale,scale).data;
        const color = pose>=0 ? [255,242,160,255] : [0,0,0,0];
        expect([...block]).toEqual(Array.from({length:scale*scale},()=>color).flat());
        expect(context.getImageData(x+left-1,y+11*scale,1,1).data[3]).toBe(0);
      }
    }
  });
});
