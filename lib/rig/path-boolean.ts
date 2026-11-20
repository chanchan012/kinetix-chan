import clipping, { type MultiPolygon, type Ring } from "polygon-clipping";
import type { BonePose } from "./kinematics";
import type { Point, VectorKnot, VectorPart } from "./model";
import { partSpace,partWorldSpace } from "./part-transform";
import { deformMesh } from "./skinning";
import { facetArtworkFaces } from "./facet-skinning";

export const booleanModes = ["compound","union","subtract","intersect","exclude"] as const;
const midpoint = (a:Point,b:Point):Point => ({x:(a.x+b.x)/2,y:(a.y+b.y)/2});

function deviation(point:Point,start:Point,end:Point) {
  const x = end.x-start.x;
  const y = end.y-start.y;
  const length = x*x+y*y;
  const t = length ? Math.max(0,Math.min(1,((point.x-start.x)*x+(point.y-start.y)*y)/length)) : 0;
  return Math.hypot(point.x-start.x-t*x,point.y-start.y-t*y);
}

function flattenRing(knots:VectorKnot[],world:(point:Point)=>Point):Ring {
  const ring:Ring = [];
  const add = (point:Point) => { ring.push([point.x,point.y]); };
  function curve(a:Point,b:Point,c:Point,d:Point,depth:number) {
    if (depth>=12 || Math.max(deviation(b,a,d),deviation(c,a,d))<=0.2) {
      add(d);
      return;
    }
    const ab = midpoint(a,b);
    const bc = midpoint(b,c);
    const cd = midpoint(c,d);
    const left = midpoint(ab,bc);
    const right = midpoint(bc,cd);
    const center = midpoint(left,right);
    curve(a,ab,left,center,depth+1);
    curve(center,right,cd,d,depth+1);
  }
  add(world(knots[0].point));
  for (let i=0;i<knots.length;i++) {
    const from = knots[i];
    const to = knots[(i+1)%knots.length];
    if (from.outgoing || to.incoming) {
      curve(world(from.point),world(from.outgoing ?? from.point),world(to.incoming ?? to.point),world(to.point),0);
    } else add(world(to.point));
    if (ring.length>4097) throw new Error("The path exceeds the polygon operation limit.");
  }
  return ring;
}

const ringFor = (points:Point[]):Ring => points.map(({x,y})=>[x,y]);

export function pathRegions(part:VectorPart,poses:Map<string,BonePose>):MultiPolygon {
  if (!part.closed) throw new Error("Choose closed artwork for the polygon operation.");
  if (part.facets || part.mesh) {
    const polygons = part.facets ? facetArtworkFaces(part,poses).flatMap(face=>face.polygons) :
      (() => {
        const points = deformMesh(part,poses);
        return part.mesh!.triangles.map(triangle=>triangle.map(index=>points[index]));
      })();
    return polygons.length ? clipping.union([ringFor(polygons[0])],...polygons.slice(1).map(poly=>[ringFor(poly)])) : [];
  }
  const world = (point:Point)=>partWorldSpace(point,part,poses);
  const rings = [part.knots,...(part.contours ?? [])].map(knots=>[flattenRing(knots,world)]);
  return rings.length===1 ? clipping.union(rings[0]) : clipping.xor(rings[0],...rings.slice(1));
}

export function intersectRegions(first:MultiPolygon,next:MultiPolygon) {
  return first.length && next.length ? clipping.intersection(first,next) : [];
}

export function regionPolygons(regions:MultiPolygon):Point[][] {
  return regions.flatMap(polygon=>polygon.map(ring=>ring.slice(0,-1).map(([x,y])=>({x,y}))));
}

/** Evaluate one assembly in document space, then preserve the first path's local coordinate system. */
export function booleanPath(parts:VectorPart[],mode:typeof booleanModes[number],poses:Map<string,BonePose>) {
  if (mode==="compound" && parts.every(part=>part.closed && !part.mesh && !part.facets)) {
    const [base,...rest] = parts;
    const contours = [...(base.contours ?? [])];
    for (const part of rest) {
      const inBase = (point:Point) => partSpace(partWorldSpace(point,part,poses),base,poses);
      for (const contour of [part.knots,...(part.contours ?? [])]) {
        contours.push(contour.map(knot=>({
          point:inBase(knot.point),
          ...(knot.incoming && {incoming:inBase(knot.incoming)}),
          ...(knot.outgoing && {outgoing:inBase(knot.outgoing)}),
        })));
      }
    }
    return {knots:base.knots,contours};
  }
  const [first,...rest] = parts.map(part=>pathRegions(part,poses));
  const output = mode==="union" ? clipping.union(first,...rest) :
    mode==="intersect" ? clipping.intersection(first,...rest) :
      mode==="subtract" ? clipping.difference(first,...rest) : clipping.xor(first,...rest);
  const rings = regionPolygons(output).map(points=>points.map(point=>({point:partSpace(point,parts[0],poses)})));
  if (!rings.length) throw new Error("The operation returned an empty path.");
  const index = rings.findIndex(ring=>ring.length<=256);
  if (index<0 || rings.some(ring=>ring.length>2048)) throw new Error("The result exceeds the editable path limit.");
  const [knots] = rings.splice(index,1);
  return {knots,contours:rings.length ? rings : undefined};
}
