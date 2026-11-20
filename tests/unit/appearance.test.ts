import { createCanvas, loadImage } from "@napi-rs/canvas";
import { applyPatches } from "immer";
import { describe, expect, it } from "vitest";
import type { Paint, PaintValue } from "../../lib/rig/appearance";
import { compileLottie } from "../../lib/export/lottie";
import { renderPngFrame } from "../../lib/export/raster";
import { editRig } from "../../lib/rig/commands";
import { createBlankRig, readRigState, type KinetixRigState, type VectorPart } from "../../lib/rig/model";

function box(id:string,left:number,top:number,right:number,bottom:number,fill="#008844"):VectorPart {
  return {
    id,name:id,parentId:null,offset:{x:0,y:0},fill,closed:true,
    knots:[{point:{x:left,y:top}},{point:{x:right,y:top}},{point:{x:right,y:bottom}},{point:{x:left,y:bottom}}],
  };
}

const artboard = () => createBlankRig({name:"Badge",width:96,height:96,background:null});
const snapshot = (rig:KinetixRigState) => ({rig,name:"Badge",fps:24,frameCount:1,startFrame:0,endFrame:0,tracks:[]});
const linked:Paint = {kind:"swatch",id:"brand"};
const teal:PaintValue = {kind:"solid",color:"#008844"};
const purple:PaintValue = {kind:"solid",color:"#6600cc"};

async function sample(rig:KinetixRigState) {
  const image = await loadImage(renderPngFrame(snapshot(rig)));
  const context = createCanvas(image.width,image.height).getContext("2d");
  context.drawImage(image,0,0);
  return (x:number,y:number) => Array.from(context.getImageData(x,y,1,1).data);
}

function badge() {
  const [rig] = editRig(artboard(),[
    {type:"swatch.set",swatch:{id:"brand",name:"Brand",paint:teal}},
    {type:"part.create",part:{...box("badge",12,12,84,84),appearance:{fill:linked}}},
    {type:"part.create",part:box("hole",42,36,58,58)},
    {type:"parts.boolean",ids:["badge","hole"],mode:"subtract"},
    {type:"part.create",part:{...box("shine",0,16,96,30),appearance:{fill:{
      kind:"linear",from:{x:0,y:16},to:{x:96,y:16},
      stops:[{offset:0,color:"#000000"},{offset:1,color:"#ffffff"}],
    }}}},
    {type:"part.create",part:{...box("label",26,64,36,72),appearance:{fill:null,opacity:0.5,stroke:{
      paint:linked,width:4,cap:"round",join:"bevel",miter:3,dash:[6,1],offset:2,
    }}}},
    {type:"layer.group",id:"highlights",name:"Highlights",members:["shine"]},
    {type:"layer.mask",id:"highlights",partId:"badge"},
  ]);
  return rig;
}

describe("shared vector appearance",()=>{
  it("preserves a linked, clipped badge in the saved rig, raster output, and Lottie",async ()=>{
    const rig = readRigState(JSON.parse(JSON.stringify(badge())));
    expect(rig.parts.map(part=>part.id)).toEqual(["badge","shine","label"]);
    const pixel = await sample(rig);
    expect(pixel(18,40)).toEqual([0,136,68,255]);
    expect(pixel(50,46)).toEqual([0,0,0,0]);
    expect(pixel(5,20)).toEqual([0,0,0,0]);
    expect(pixel(18,20)[0]).toBeLessThan(pixel(72,20)[0]);
    expect(pixel(18,20)[3]).toBe(255);

    const [changed,,undo] = editRig(rig,[{type:"swatch.set",swatch:{id:"brand",name:"Brand",paint:purple}}]);
    expect((await sample(changed))(18,40)).toEqual([102,0,204,255]);
    expect(applyPatches(changed,undo)).toEqual(rig);
    const [detached] = editRig(changed,[{type:"swatch.remove",id:"brand"}]);
    expect(detached.parts[0].appearance?.fill).toEqual(purple);
    expect(detached.parts[2].appearance?.stroke?.paint).toEqual(purple);
    expect(renderPngFrame(snapshot(detached))).toEqual(renderPngFrame(snapshot(changed)));

    const {layers} = compileLottie(snapshot(changed));
    expect(layers.find(layer=>layer.shapes.at(-1)?.ty==="fl")?.shapes).toMatchObject([
      {ty:"sh"},{ty:"sh"},{ty:"fl",r:2,c:{k:[0.4,0,0.8]}},
    ]);
    expect(layers.find(layer=>layer.shapes.at(-1)?.ty==="gf")).toMatchObject({
      hasMask:true,masksProperties:[{mode:"a"},{mode:"s"}],
      shapes:[{ty:"sh"},{ty:"gf",g:{p:2,k:{k:[0,0,0,0,1,1,1,1]}}}],
    });
    expect(layers.find(layer=>layer.shapes.at(-1)?.ty==="st")?.shapes.at(-1)).toMatchObject({
      ty:"st",c:{k:[0.4,0,0.8]},lc:2,lj:3,o:{k:50},d:[{n:"d",v:{k:6}},{n:"g",v:{k:1}},{n:"o",v:{k:2}}],
    });
  });

  it.each([
    ["union",[255,255,255]],["subtract",[255,0,0]],["intersect",[0,255,0]],
    ["exclude",[255,0,255]],["compound",[255,0,255]],
  ] as const)("renders the %s result at its three overlap regions",async (mode,alpha)=>{
    const [rig] = editRig(artboard(),[
      {type:"part.create",part:{...box("base",0,12,40,40),offset:{x:8,y:0}}},
      {type:"part.create",part:box("tool",36,12,72,40)},
      {type:"parts.boolean",ids:["base","tool"],mode},
    ]);
    expect(rig.parts).toMatchObject([{id:"base",offset:{x:8,y:0}}]);
    const pixel = await sample(rig);
    expect([16,42,64].map(x=>pixel(x,26)[3])).toEqual(alpha);
  });

  it("intersects nested clipping masks and remaps a copied group's mask reference",async ()=>{
    const [rig] = editRig(artboard(),[
      {type:"part.create",part:box("drawing",0,0,96,96)},
      {type:"part.create",part:box("horizontal",10,30,90,60)},
      {type:"part.create",part:box("vertical",30,10,60,90)},
      {type:"layer.group",id:"inner",name:"Inner",members:["drawing","horizontal"]},
      {type:"layer.group",id:"outer",name:"Outer",members:["inner","vertical"]},
      {type:"layer.mask",id:"inner",partId:"horizontal"},
      {type:"layer.mask",id:"outer",partId:"vertical"},
      {type:"layer.flags",id:"horizontal",hidden:true},
      {type:"layer.flags",id:"vertical",hidden:true},
    ]);
    const pixel = await sample(rig);
    expect([pixel(15,40)[3],pixel(40,15)[3],pixel(40,40)[3]]).toEqual([0,0,255]);
    const [copy] = editRig(rig,[{type:"layer.duplicate",id:"outer",prefix:"copy"}]);
    expect(copy.layers?.nodes.find(node=>node.id==="copy-0")?.maskPartId).toBe("copy-4");
    expect(copy.layers?.nodes.find(node=>node.id==="copy-1")?.maskPartId).toBe("copy-3");
  });

  it("keeps Bézier handles in compound paths while mapping operands to the base path",()=>{
    const tool = box("tool",4,12,36,40);
    tool.knots[0].outgoing = {x:16,y:8};
    const [rig] = editRig(artboard(),[
      {type:"part.create",part:{...box("base",0,12,48,64),offset:{x:8,y:0}}},
      {type:"part.create",part:{...tool,offset:{x:14,y:10}}},
      {type:"parts.boolean",ids:["base","tool"],mode:"compound"},
    ]);
    expect(rig.parts[0].contours?.[0][0]).toEqual({point:{x:10,y:22},outgoing:{x:22,y:18}});
    expect(compileLottie(snapshot(rig)).layers[0].shapes[1]).toMatchObject({ty:"sh",ks:{k:{o:[[12,-4],[0,0],[0,0],[0,0],[0,0]]}}});
  });
});
