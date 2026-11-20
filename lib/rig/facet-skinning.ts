import earcut from "earcut";
import type { BonePose } from "./kinematics";
import type { FacetGraph,Point,VectorPart } from "./model";
import { facetPolygons,signedPolygonArea } from "./facet-geometry";
import { partSpace,partWorldSpace } from "./part-transform";
import { deformMesh } from "./skinning";

type Triangle = [Point,Point,Point];
type Region = { id:string;fill:string;polygons:Point[][] };
type Bounds = { minX:number;minY:number;maxX:number;maxY:number };
const epsilon = 1e-8;
const cross = (a:Point,b:Point,p:Point) => (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
const normalize = (points:Point[]) => signedPolygonArea(points)<0 ? points.reverse() : points;
const nonEmpty = (points:Point[]) => points.length>=3 && Math.abs(signedPolygonArea(points))>epsilon;

function bounds(points:readonly Point[]):Bounds {
  return {
    minX:Math.min(...points.map(point=>point.x)),minY:Math.min(...points.map(point=>point.y)),
    maxX:Math.max(...points.map(point=>point.x)),maxY:Math.max(...points.map(point=>point.y)),
  };
}

function overlaps(a:Bounds,b:Bounds) {
  return a.minX<b.maxX && b.minX<a.maxX && a.minY<b.maxY && b.minY<a.maxY;
}

function halfPlane(points:Point[],a:Point,b:Point,side:number):Point[] {
  const result:Point[] = [];
  let last = points.at(-1)!;
  let previous = cross(a,b,last)*side;
  for (const point of points) {
    const distance = cross(a,b,point)*side;
    if ((previous>=0)!==(distance>=0)) {
      const fraction = previous/(previous-distance);
      result.push({x:last.x+(point.x-last.x)*fraction,y:last.y+(point.y-last.y)*fraction});
    }
    if (distance>=0) result.push(point);
    last = point;
    previous = distance;
  }
  return result;
}

function partition(points:Point[],triangle:Triangle) {
  let inside = points;
  const outside:Point[][] = [];
  const side = Math.sign(cross(...triangle));
  for (let edge=0;edge<3;edge++) {
    const a = triangle[edge];
    const b = triangle[(edge+1)%3];
    const leftover = halfPlane(inside,a,b,-side);
    if (nonEmpty(leftover)) outside.push(leftover);
    inside = halfPlane(inside,a,b,side);
    if (!nonEmpty(inside)) return {inside:[],outside:[points]};
  }
  return {inside,outside};
}

function remap(point:Point,rest:Triangle,posed:Triangle):Point {
  const area = cross(...rest);
  const a = cross(rest[1],rest[2],point)/area;
  const b = cross(rest[2],rest[0],point)/area;
  const c = 1-a-b;
  return {x:a*posed[0].x+b*posed[1].x+c*posed[2].x,y:a*posed[0].y+b*posed[1].y+c*posed[2].y};
}

function triangleContains(triangle:Triangle,point:Point) {
  const side = Math.sign(cross(...triangle));
  return side!==0 && triangle.every((vertex,index)=>side*cross(vertex,triangle[(index+1)%3],point)>=-epsilon);
}

function skinPieces(part:VectorPart,poses:Map<string,BonePose>) {
  const mesh = part.mesh;
  if (!mesh) return [];
  const vertices = deformMesh(part,poses);
  return mesh.triangles.flatMap(([a,b,c])=>{
    const rest:Triangle = [mesh.vertices[a].point,mesh.vertices[b].point,mesh.vertices[c].point];
    const posed:Triangle = [vertices[a],vertices[b],vertices[c]];
    return Math.abs(cross(...rest))>epsilon ? [{rest,posed,bounds:bounds(rest)}] : [];
  });
}

export function facetPointMappers(part:VectorPart,poses:Map<string,BonePose>) {
  const pieces = skinPieces(part,poses);
  return {
    world(point:Point) {
      const triangle = pieces.find(piece=>triangleContains(piece.rest,point));
      return triangle ? remap(point,triangle.rest,triangle.posed) : partWorldSpace(point,part,poses);
    },
    local(point:Point) {
      const triangle = pieces.find(piece=>triangleContains(piece.posed,point));
      return triangle ? remap(point,triangle.posed,triangle.rest) : partSpace(point,part,poses);
    },
  };
}

const triangleCache = new WeakMap<FacetGraph,{id:string;fill:string;triangles:Triangle[]}[]>();

function faceTriangles(graph:FacetGraph) {
  const cached = triangleCache.get(graph);
  if (cached) return cached;
  const faces = facetPolygons(graph).map(({id,fill,points})=>{
    const indices = earcut(points.flatMap(point=>[point.x,point.y]));
    const triangles:Triangle[] = [];
    for (let index=0;index<indices.length;index+=3) {
      triangles.push([points[indices[index]],points[indices[index+1]],points[indices[index+2]]]);
    }
    return {id,fill,triangles};
  });
  triangleCache.set(graph,faces);
  return faces;
}

/** Sample the independent visual face graph over the piecewise-affine skinning surface. */
export function facetArtworkFaces(part:VectorPart,poses:Map<string,BonePose>):Region[] {
  if (!part.facets) return [];
  const world = (point:Point)=>partWorldSpace(point,part,poses);
  if (!part.mesh) return facetPolygons(part.facets).map(({id,fill,points})=>({id,fill,polygons:[normalize(points.map(world))]}));
  const pieces = skinPieces(part,poses);
  return faceTriangles(part.facets).map(({id,fill,triangles})=>{
    const polygons:Point[][] = [];
    for (const triangle of triangles) {
      const region = bounds(triangle);
      let uncovered:Point[][] = [triangle];
      for (const piece of pieces) {
        if (!uncovered.length) break;
        if (!overlaps(region,piece.bounds)) continue;
        uncovered = uncovered.flatMap(poly=>{
          const {inside,outside} = partition(poly,piece.rest);
          if (inside.length) polygons.push(normalize(inside.map(point=>remap(point,piece.rest,piece.posed))));
          return outside;
        });
      }
      for (const poly of uncovered) polygons.push(normalize(poly.map(world)));
    }
    return {id,fill,polygons};
  });
}
