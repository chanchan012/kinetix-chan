import earcut from "earcut";
import type { FacetGraph, Point } from "./model";

export const facetEdgeKey = (a:string,b:string) => a<b ? a+":"+b : b+":"+a;

export function signedPolygonArea(points:readonly Point[]): number {
  return points.reduce((sum,point,index) => {
    const next = points[(index+1)%points.length];
    return sum + point.x*next.y-next.x*point.y;
  },0)/2;
}

const turn = (a:Point,b:Point,c:Point) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const areaTolerance = 1e-8;

function intersects(a:Point,b:Point,c:Point,d:Point):boolean {
  if (Math.max(a.x,b.x)<Math.min(c.x,d.x) || Math.max(c.x,d.x)<Math.min(a.x,b.x) ||
      Math.max(a.y,b.y)<Math.min(c.y,d.y) || Math.max(c.y,d.y)<Math.min(a.y,b.y)) return false;
  const side = (p:Point,q:Point,r:Point) => Math.abs(turn(p,q,r))<areaTolerance ? 0 : Math.sign(turn(p,q,r));
  return side(a,b,c)*side(a,b,d)<=0 && side(c,d,a)*side(c,d,b)<=0;
}

/** An individual face has a simple perimeter with positive area in either winding. */
export function validFacetPolygon(points:readonly Point[]):boolean {
  const count = points.length;
  if (count<3 || Math.abs(signedPolygonArea(points))<=areaTolerance) return false;
  for (let a=0;a<count;a++) {
    const nextA = (a+1)%count;
    if (points[a].x===points[nextA].x && points[a].y===points[nextA].y) return false;
    for (let b=a+2;b<count;b++) {
      const nextB = (b+1)%count;
      if (a!==nextB && intersects(points[a],points[nextA],points[b],points[nextB])) return false;
    }
  }
  return true;
}

export function facetPolygons(graph:FacetGraph) {
  const vertices = new Map(graph.vertices.map(vertex=>[vertex.id,vertex.point]));
  return graph.faces.map(face=>{
    const points = face.vertices.map(id=>vertices.get(id)!);
    return {id:face.id,fill:face.fill,points:signedPolygonArea(points)<0 ? points.reverse() : points};
  });
}

export function splitFacetEdge(graph:FacetGraph,a:string,b:string,id:string,progress=0.5):FacetGraph {
  const start = graph.vertices.find(vertex=>vertex.id===a);
  const end = graph.vertices.find(vertex=>vertex.id===b);
  if (!start || !end || a===b) throw new Error("Choose an existing facet edge.");
  let shared = false;
  const faces = graph.faces.map(face=>{
    const vertices = face.vertices.flatMap((vertex,index)=>{
      const next = face.vertices[(index+1)%face.vertices.length];
      if ((vertex===a && next===b) || (vertex===b && next===a)) {
        shared = true;
        return [vertex,id];
      }
      return [vertex];
    });
    return {...face,vertices};
  });
  if (!shared) throw new Error("Choose an existing facet edge.");
  const point = {x:start.point.x+(end.point.x-start.point.x)*progress,y:start.point.y+(end.point.y-start.point.y)*progress};
  return {vertices:[...graph.vertices,{id,point}],faces};
}

export function cutFacetFace(graph:FacetGraph,faceId:string,a:string,b:string,id:string):FacetGraph {
  const face = graph.faces.find(item=>item.id===faceId);
  if (!face) throw new Error("Choose an existing facet face.");
  const from = face.vertices.indexOf(a);
  const to = face.vertices.indexOf(b);
  if (from<0 || to<0) throw new Error("Choose two vertices on the face.");
  const distance = Math.abs(to-from);
  if (distance<2 || distance>=face.vertices.length-1) throw new Error("Choose two non-adjacent vertices.");
  const first = Math.min(from,to);
  const last = Math.max(from,to);
  const halves = [face.vertices.slice(first,last+1),[...face.vertices.slice(last),...face.vertices.slice(0,first+1)]];
  const points = new Map(graph.vertices.map(vertex=>[vertex.id,vertex.point]));
  const area = (ids:string[])=>signedPolygonArea(ids.map(vertex=>points.get(vertex)!));
  const side = Math.sign(area(face.vertices));
  if (halves.some(vertices=>Math.sign(area(vertices))!==side)) throw new Error("The cut must stay inside the face.");
  return {...graph,faces:graph.faces.flatMap(item=>item.id!==faceId ? [item] : [
    {...face,vertices:halves[0]},
    {...face,id,vertices:halves[1]},
  ])};
}

export function weldFacetVertices(graph:FacetGraph,retained:string,removed:string):FacetGraph {
  if (retained===removed || !graph.vertices.some(vertex=>vertex.id===retained) ||
      !graph.vertices.some(vertex=>vertex.id===removed)) throw new Error("Choose two distinct facet vertices.");
  const faces = graph.faces.map(face=>{
    const assigned = face.vertices.map(vertex=>vertex===removed ? retained : vertex);
    const vertices = assigned.filter((vertex,index)=>vertex!==assigned[(index+assigned.length-1)%assigned.length]);
    return {...face,vertices};
  });
  return {vertices:graph.vertices.filter(vertex=>vertex.id!==removed),faces};
}

export function mirrorFacets(graph:FacetGraph,axis:"x"|"y",at:number,prefix:string):FacetGraph {
  const offAxis = graph.vertices.filter(vertex=>Math.abs(vertex.point[axis]-at)>areaTolerance);
  const ids = new Map(offAxis.map((vertex,index)=>[vertex.id,prefix+"-v"+index]));
  return {
    vertices:[...graph.vertices,...offAxis.map(vertex=>({
      id:ids.get(vertex.id)!,point:{...vertex.point,[axis]:2*at-vertex.point[axis]},
    }))],
    faces:[...graph.faces,...graph.faces.map((face,index)=>({
      ...face,id:prefix+"-f"+index,vertices:face.vertices.toReversed().map(id=>ids.get(id)??id),
    }))],
  };
}

export function triangulateFacets(graph:FacetGraph,prefix:string,faceId?:string):FacetGraph {
  const points = new Map(graph.vertices.map(vertex=>[vertex.id,vertex.point]));
  let next = 0;
  const faces = graph.faces.flatMap(face=>{
    if ((faceId && face.id!==faceId) || face.vertices.length===3) return [face];
    const trace = face.vertices.flatMap(vertex=>{
      const point = points.get(vertex)!;
      return [point.x,point.y];
    });
    const indices = earcut(trace);
    const triangles = Array.from({length:indices.length/3},(_,i)=>
      indices.slice(i*3,i*3+3).map(index=>face.vertices[index]));
    const included = new Set(triangles.flat());
    for (const vertex of face.vertices.filter(id=>!included.has(id))) {
      const point = points.get(vertex)!;
      const position = triangles.findIndex(triangle=>triangle.some((id,index)=>{
        const a = points.get(id)!;
        const b = points.get(triangle[(index+1)%3])!;
        return onSegment(a,b,point);
      }));
      if (position<0) throw new Error("Could not preserve a facet boundary vertex during triangulation.");
      const triangle = triangles[position];
      const edge = triangle.findIndex((id,index)=>onSegment(points.get(id)!,points.get(triangle[(index+1)%3])!,point));
      const a = triangle[edge];
      const b = triangle[(edge+1)%3];
      const c = triangle[(edge+2)%3];
      triangles.splice(position,1,[a,vertex,c],[vertex,b,c]);
    }
    return triangles.map((vertices,i)=>({
      id:i===0 ? face.id : prefix+"-"+next++,
      vertices,fill:face.fill,
    }));
  });
  return {...graph,faces};
}

function onSegment(a:Point,b:Point,p:Point) {
  return Math.abs(turn(a,b,p))<=areaTolerance &&
    (p.x-a.x)*(p.x-b.x)+(p.y-a.y)*(p.y-b.y)<0;
}
