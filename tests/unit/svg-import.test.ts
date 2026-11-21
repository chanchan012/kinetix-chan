import { readFileSync } from "node:fs";
import { createCanvas,loadImage } from "@napi-rs/canvas";
import { describe,expect,it } from "vitest";
import { compileLottie } from "../../lib/export/lottie";
import { renderPngFrame } from "../../lib/export/raster";
import { editRig } from "../../lib/rig/commands";
import { orderedLayers,layerTreeFor } from "../../lib/rig/layer-tree";
import { createBlankRig,readRigState } from "../../lib/rig/model";
import { createRigStore } from "../../lib/rig/store";
import { planSvgImport,svgImportByteLimit } from "../../lib/rig/svg-import";

const source=readFileSync("tests/fixtures/layered-artwork.svg","utf8");
const artboard={name:"Lantern",width:120,height:96,background:null};
const rig=createBlankRig(artboard);
const options={importId:"fixture"};
const snapshot=(state:typeof rig)=>({rig:state,name:"Lantern",fps:24,frameCount:1,startFrame:0,endFrame:0,tracks:[]});

async function bitmap(bytes:Buffer|string) {
  const image=await loadImage(typeof bytes==="string" ? Buffer.from(bytes) : bytes);
  const ctx=createCanvas(120,96).getContext("2d");
  ctx.drawImage(image,0,0);
  return (x:number,y:number)=>Array.from(ctx.getImageData(x,y,1,1).data);
}

describe("editable SVG import",()=>{
  it("preserves layers, cubic handles, nonzero holes, clips and transparent gradients through save and export",async ()=>{
    const plan=planSvgImport(source,options);
    expect(plan).toMatchObject({name:"Layered lantern",partCount:4,maskCount:2,viewport:{width:120,height:96},
      diagnostics:[{element:"text #Caption",message:expect.stringContaining("skipped")}]});
    const store=createRigStore(rig);
    store.getState().dispatch("Import SVG",{kind:"human",id:"artist"},...plan.commands);
    const state=readRigState(JSON.parse(JSON.stringify(store.getState().rig)));
    const path=(name:string)=>state.parts.find(part=>part.name===name)!;
    expect(path("Badge")).toMatchObject({fillRule:"nonzero",contours:[expect.any(Array)]});
    expect(path("Badge").knots).toHaveLength(4);
    expect(path("Badge").knots[0].point.x).toBeCloseTo(12);
    expect(path("Badge").knots[0].point.y).toBeCloseTo(14.4);
    expect(path("Curve").knots[0].outgoing?.x).toBeCloseTo(94.8);
    expect(path("Curve").appearance?.stroke).toMatchObject({cap:"round",opacity:0.6,width:2.4});
    expect(path("Glow").appearance?.fill).toMatchObject({kind:"linear",stops:[
      {offset:0,color:"#ffffff",opacity:0.5},{offset:1,color:"#ff7b29"},
    ]});
    const rows=orderedLayers(layerTreeFor(state));
    expect(rows.find(({node})=>node.kind==="part" && node.partId===path("Glow").id)).toMatchObject({depth:3,masks:[expect.any(String),expect.any(String)]});
    expect(rows.find(({node})=>node.kind==="part" && node.partId===path("Slit").id)?.hidden).toBe(true);
    const actual=await bitmap(renderPngFrame(snapshot(state)));
    const independent=await bitmap(source);
    for (const [x,y] of [[15,65],[45,48],[11,16],[17,20],[57,22],[89,20],[102,61]]) {
      actual(x,y).forEach((channel,index)=>expect(Math.abs(channel-independent(x,y)[index]),`pixel ${x},${y} channel ${index}`).toBeLessThanOrEqual(5));
    }
    expect(actual(45,48)).toEqual([0,0,0,0]);
    expect(actual(102,61)).toEqual([214,27,85,255]);
    const lottie=compileLottie(snapshot(state));
    expect(lottie.layers.flatMap(layer=>layer.shapes)).toContainEqual(expect.objectContaining({ty:"gf",g:{p:2,
      k:{a:0,k:[0,1,1,1,1,1,123/255,41/255,0,0.5,1,1]}},r:1}));

    store.getState().undo();
    expect(store.getState().rig).toEqual(rig);
    store.getState().redo();
    expect(renderPngFrame(snapshot(store.getState().rig))).toEqual(renderPngFrame(snapshot(state)));
    const [edited]=editRig(state,[{type:"part.update",id:path("Badge").id,changes:{appearance:{fill:{kind:"solid",color:"#cc3300"}}}}]);
    expect((await bitmap(renderPngFrame(snapshot(edited))))(15,65)).toEqual([204,51,0,255]);
  });

  it("preserves same-winding fills and fits artwork with a nested viewport and object-bounding-box clip",async ()=>{
    const svg=`<svg width="200" height="100" viewBox="0 0 200 100"><defs>
      <clipPath id="clip" clipPathUnits="objectBoundingBox"><rect width=".5" height="1"/></clipPath>
      </defs><g transform="translate(20 10)" clip-path="url(#clip)">
        <svg x="20" y="10" width="100" height="60" viewBox="0 0 100 60">
          <path d="M0 0 H100 V60 H0Z M10 10 H40 V40 H10Z" fill="red"/>
        </svg>
      </g></svg>`;
    const plan=planSvgImport(svg,{...options,fit:artboard});
    expect(plan).toMatchObject({partCount:1,placement:{x:0,y:18,scale:0.6},diagnostics:[]});
    const [state]=editRig(rig,plan.commands);
    const pixel=await bitmap(renderPngFrame(snapshot(state)));
    expect(pixel(36,42)).toEqual([255,0,0,255]);
    expect(pixel(70,42)).toEqual([0,0,0,0]);
  });

  it("reports unsupported assets, external references and malformed paths without applying them",()=>{
    const literal=`<svg><defs><pattern id="tile"/></defs><rect id="Tile" width="10" height="10" fill="url(#tile) #0f0"/>
      <path id="broken" d="M0 0 L"/><use href="other.svg#dot"/><image href="other.png"/><script/></svg>`;
    const plan=planSvgImport(literal,options);
    expect(plan.partCount).toBe(1);
    expect(plan.diagnostics.map(item=>item.element)).toEqual(["rect #Tile","path #broken","use","image","script"]);
    expect(plan.commands.find(command=>command.type==="part.create")).toMatchObject({part:{fill:"#00ff00"}});
    expect(planSvgImport("<svg><text>Title</text></svg>",options).commands).toEqual([]);
    expect(()=>planSvgImport("<!DOCTYPE svg><svg/>",options)).toThrow("DOCTYPE");
    expect(()=>planSvgImport("<svg><g></svg>",options)).toThrow("Invalid SVG XML");
    expect(()=>planSvgImport("<svg>"+"é".repeat(svgImportByteLimit/2)+"</svg>",options)).toThrow("512 KB");
  });

  it("skips incomplete CSS, conditional rules and oversized transforms while retaining supported paths",()=>{
    const source=`<svg><style>${"x".repeat(80_000)}</style><style>@media screen {.alert { fill: red; }}</style>
      <rect class="alert" width="40" height="24"/><rect width="40" height="24" transform="${"x".repeat(5000)}"/></svg>`;
    const plan=planSvgImport(source,options);
    expect(plan.partCount).toBe(1);
    expect(plan.diagnostics.map(value=>value.message)).toEqual([
      expect.stringContaining("Incomplete stylesheet"),expect.stringContaining("CSS at-rules"),expect.stringContaining("transform exceeds"),
    ]);
    expect(plan.commands.find(command=>command.type==="part.create")).toMatchObject({part:{fill:"#000000"}});
  });
});
