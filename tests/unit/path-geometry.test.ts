import { describe, expect, it } from "vitest";
import { editRig } from "../../lib/rig/commands";
import { evaluateRig } from "../../lib/rig/kinematics";
import { createBlankRig, type Point, type VectorPart } from "../../lib/rig/model";
import { movePathKnot, pencilKnots, primitiveKnots, splitPathEdge } from "../../lib/rig/path-geometry";
import { worldPartBounds } from "../../lib/rig/path-layout";

const blank = () => createBlankRig({name:"Logo fixture",width:320,height:240,background:null});
const part = (id:string, points:Point[], changes:Partial<VectorPart> = {}):VectorPart => ({
  id,name:id,parentId:null,offset:{x:0,y:0},fill:"#3366aa",closed:false,
  knots:points.map(point=>({point})),...changes,
});

describe("precision path and layout commands",()=>{
  it("generates exact primitive bounds and keeps endpoints during pencil smoothing",()=>{
    const rectangle = primitiveKnots("rectangle",{x:40,y:20},{x:5,y:0},true);
    expect(rectangle.map(knot=>knot.point)).toEqual([{x:20,y:0},{x:40,y:0},{x:40,y:20},{x:20,y:20}]);
    const ellipse = part("ellipse",[],{closed:true,knots:primitiveKnots("ellipse",{x:0,y:10},{x:40,y:30},false)});
    expect(worldPartBounds(ellipse,new Map())).toEqual({min:{x:0,y:10},max:{x:40,y:30}});
    expect(primitiveKnots("star",{x:0,y:0},{x:20,y:20},false)).toHaveLength(10);
    const points = [{x:0,y:0},{x:4,y:0.1},{x:8,y:0},{x:12,y:8},{x:15,y:10}];
    const pencil = pencilKnots(points,1);
    expect(pencil.length).toBeLessThan(points.length);
    expect(pencil[0].point).toEqual(points[0]);
    expect(pencil.at(-1)?.point).toEqual(points.at(-1));
    expect(pencil[0].outgoing).toBeDefined();
  });

  it("splits a cubic exactly and retains its curve when reversing the path",()=>{
    const curve = part("curve",[],{knots:[
      {point:{x:0,y:0},outgoing:{x:0,y:8}}, {point:{x:16,y:0},incoming:{x:16,y:8}},
    ]});
    expect(splitPathEdge(curve,0)).toEqual([
      {point:{x:0,y:0},outgoing:{x:0,y:4}},
      {point:{x:8,y:6},incoming:{x:4,y:6},outgoing:{x:12,y:6},mode:"smooth"},
      {point:{x:16,y:0},incoming:{x:16,y:4}},
    ]);
    const [rig] = editRig(blank(),[
      {type:"part.create",part:curve},{type:"part.splitEdge",id:"curve",edge:0},{type:"part.reverse",id:"curve"},
    ]);
    expect(rig.parts[0].knots[1]).toEqual({point:{x:8,y:6},incoming:{x:12,y:6},outgoing:{x:4,y:6},mode:"smooth"});
    expect(movePathKnot(rig.parts[0].knots[1],"outgoing",{x:8,y:12}).incoming).toEqual({x:8,y:2});
    expect(worldPartBounds(rig.parts[0],new Map())).toEqual(worldPartBounds(curve,new Map()));
  });

  it("cuts and joins open paths and simplifies only their straight runs",()=>{
    const [rig] = editRig(blank(),[
      {type:"part.create",part:part("drawing",[{x:0,y:0},{x:20,y:0},{x:30,y:0},{x:50,y:0}])},
      {type:"part.cut",id:"drawing",index:1,newId:"split"},
      {type:"part.join",id:"drawing",sourceId:"split"},
      {type:"part.simplify",id:"drawing",tolerance:0.5},
      {type:"part.nodeMode",id:"drawing",index:0,mode:"smooth"},
    ]);
    expect(rig.parts).toHaveLength(1);
    expect(rig.parts[0].knots.map(knot=>knot.point)).toEqual([{x:0,y:0},{x:50,y:0}]);
    expect(rig.parts[0].knots[0].outgoing?.x).toBeCloseTo(50/3);
  });

  it("aligns transformed bounds and distributes equal gaps through the shared command",()=>{
    const parts = [
      part("left",[{x:0,y:4},{x:10,y:24}],{offset:{x:0,y:10}}),
      part("middle",[{x:0,y:0},{x:10,y:24}],{offset:{x:45,y:25},scale:{x:2,y:1}}),
      part("right",[{x:0,y:0},{x:30,y:24}],{offset:{x:100,y:0}}),
    ];
    const ids = parts.map(item=>item.id);
    const [rig] = editRig(blank(),[
      ...parts.map(item=>({type:"part.create" as const,part:item})),
      {type:"parts.layout",ids,axis:"y",mode:"min"},{type:"parts.layout",ids,axis:"x",mode:"distribute"},
      {type:"parts.translate",ids,delta:{x:5,y:8}},
    ]);
    const bounds = rig.parts.map(item=>worldPartBounds(item,evaluateRig(rig)));
    expect(bounds.map(item=>item.min)).toEqual([{x:5,y:8},{x:50,y:8},{x:105,y:8}]);
    expect(bounds[1].min.x-bounds[0].max.x).toBe(bounds[2].min.x-bounds[1].max.x);
  });
});
