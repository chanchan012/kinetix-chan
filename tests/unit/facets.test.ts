import { createCanvas,loadImage } from "@napi-rs/canvas";
import { describe,expect,it } from "vitest";
import { renderPngFrame } from "../../lib/export/raster";
import { editRig } from "../../lib/rig/commands";
import { evaluateRig } from "../../lib/rig/kinematics";
import { createBlankRig,facetGraphSchema,type FacetGraph,type KinetixRigState,type VectorPart } from "../../lib/rig/model";
import { worldPartBounds } from "../../lib/rig/path-layout";
import { bindMesh } from "../../lib/rig/skinning";

const graph:FacetGraph = {
  vertices:[
    {id:"a",point:{x:10,y:10}},{id:"b",point:{x:90,y:10}},
    {id:"c",point:{x:50,y:90}},{id:"center",point:{x:50,y:40}},
  ],
  faces:[
    {id:"upper",vertices:["a","b","center"],fill:"#ff0000"},
    {id:"right",vertices:["b","c","center"],fill:"#00b400"},
    {id:"left",vertices:["c","a","center"],fill:"#0022ff"},
  ],
};
const blank = () => createBlankRig({name:"Faceted lantern",width:100,height:100,background:null});
const part:VectorPart = {id:"lantern",name:"Lantern",parentId:null,offset:{x:0,y:0},closed:true,fill:"#ff0000",
  knots:graph.vertices.slice(0,3).map(vertex=>({point:vertex.point})),facets:graph};

async function pixels(rig:KinetixRigState) {
  const image = await loadImage(renderPngFrame({rig,name:"Facets",fps:24,frameCount:1,startFrame:0,endFrame:0,tracks:[]}));
  const ctx = createCanvas(100,100).getContext("2d");
  ctx.drawImage(image,0,0);
  return (x:number,y:number)=>Array.from(ctx.getImageData(x,y,1,1).data);
}

describe("independent facet and deformation topology",()=>{
  it("moves a shared junction with all three colors and no transparent seam",async()=>{
    const [rig] = editRig(blank(),[
      {type:"part.create",part},{type:"facet.move",id:part.id,vertexId:"center",point:{x:57,y:47}},
      {type:"facet.splitEdge",id:part.id,a:"a",b:"center",vertexId:"split"},
    ]);
    const faces = rig.parts[0].facets!.faces;
    expect(faces.filter(face=>face.vertices.includes("split")).map(face=>face.id)).toEqual(["upper","left"]);
    expect(faces.every(face=>face.vertices.includes("center"))).toBe(true);
    const rgba = await pixels(rig);
    expect(rgba(50,20)).toEqual([255,0,0,255]);
    expect(rgba(64,49)).toEqual([0,180,0,255]);
    expect(rgba(37,47)).toEqual([0,34,255,255]);
    for (let y=12;y<85;y++) {
      const inset = (y-10)/2;
      for (let x=Math.ceil(11+inset);x<89-inset;x++) expect(rgba(x,y)[3]).toBe(255);
    }
    expect(rgba(4,4)[3]).toBe(0);
  });

  it("cuts, welds, mirrors and triangulates faces with validated references",()=>{
    const square = {...part,facets:undefined,knots:[
      {point:{x:0,y:0}},{point:{x:20,y:0}},{point:{x:20,y:20}},{point:{x:0,y:20}},
    ]};
    const [rig] = editRig(blank(),[
      {type:"part.create",part:square},
      {type:"facet.initialize",id:part.id,faceId:"panel"},
      {type:"facet.cut",id:part.id,faceId:"panel",a:"vertex-1",b:"vertex-3",nextFaceId:"other"},
      {type:"facet.splitEdge",id:part.id,a:"vertex-1",b:"vertex-3",vertexId:"extra"},
      {type:"facet.weld",id:part.id,retained:"vertex-1",removed:"extra"},
      {type:"facet.paint",id:part.id,faceId:"other",fill:"#5540aa"},
      {type:"facet.mirror",id:part.id,axis:"x",at:0,prefix:"mirror"},
      {type:"facet.triangulate",id:part.id,prefix:"auto"},
    ]);
    const result = facetGraphSchema.parse(rig.parts[0].facets);
    expect(result.vertices.filter(vertex=>vertex.point.x===0)).toHaveLength(2);
    expect(result.faces.map(face=>face.fill)).toEqual(["#ff0000","#5540aa","#ff0000","#5540aa"]);
    expect(result.faces.every(face=>face.vertices.length===3)).toBe(true);
  });

  it("triangulates a selected face while preserving vertices it shares with a neighbor",()=>{
    const [rig] = editRig(blank(),[
      {type:"part.create",part:{...part,facets:undefined,knots:[
        {point:{x:10,y:10}},{point:{x:50,y:10}},{point:{x:50,y:50}},{point:{x:10,y:50}},
      ]}},
      {type:"facet.initialize",id:part.id,faceId:"square"},
      {type:"facet.add",id:part.id,faceId:"wing",fill:"#00b400",vertices:[
        {id:"vertex-2"},{id:"vertex-3"},{id:"tip",point:{x:70,y:25}},
      ]},
      {type:"facet.splitEdge",id:part.id,a:"vertex-2",b:"vertex-3",vertexId:"join"},
      {type:"facet.triangulate",id:part.id,faceId:"square",prefix:"triangle"},
    ]);
    const faces = facetGraphSchema.parse(rig.parts[0].facets).faces;
    expect(faces.filter(face=>face.id!=="wing").every(face=>face.vertices.length===3)).toBe(true);
    expect(faces.filter(face=>face.vertices.includes("join")).length).toBeGreaterThanOrEqual(2);
    expect(faces.find(face=>face.id==="wing")?.fill).toBe("#00b400");
  });

  it("subdivides weighted triangles without changing the posed face colors or silhouette",async()=>{
    const rig = blank();
    rig.bones.push(
      {id:"root",name:"Root",parentId:null,length:10,offset:{x:0,y:0},rotation:0},
      {id:"arm",name:"Arm",parentId:null,length:12,offset:{x:62,y:42},rotation:0},
    );
    const mesh = bindMesh(part,evaluateRig(rig),"root");
    mesh.vertices = mesh.vertices.map(vertex=>{
      const weight = Math.min(0.8,Math.max(0.2,vertex.point.x/100));
      return {...vertex,weights:[{boneId:"arm",weight},{boneId:"root",weight:1-weight}]};
    });
    rig.parts.push({...part,mesh});
    rig.bones[1].rotation=0.29;
    const [after] = editRig(rig,[{type:"mesh.splitTriangle",id:part.id,index:0}]);
    expect(after.parts[0].facets).toEqual(graph);
    expect(after.parts[0].mesh!.vertices.at(-1)?.splitFrom).toEqual(mesh.triangles[0]);
    const sourceBounds = worldPartBounds(rig.parts[0],evaluateRig(rig));
    const afterBounds = worldPartBounds(after.parts[0],evaluateRig(after));
    expect(afterBounds.min.x).toBeCloseTo(sourceBounds.min.x);
    expect(afterBounds.max.y).toBeCloseTo(sourceBounds.max.y);
    const beforePixels = await pixels(rig);
    const afterPixels = await pixels(after);
    for (const point of [[40,21],[63,50],[33,48],[4,4]]) expect(afterPixels(point[0],point[1])).toEqual(beforePixels(point[0],point[1]));
  });
});
