import type { Point, VectorKnot, VectorPart } from "./model";
import type { BonePose } from "./kinematics";
import { partParentSpace, partWorldSpace } from "./part-transform";
import { deformMesh } from "./skinning";
import { facetArtworkFaces } from "./facet-skinning";

export type Axis = "x" | "y";
export type Anchor = "min" | "center" | "max";
export type Bounds = { min:Point; max:Point };

export function pointBounds(points:readonly Point[]): Bounds {
  const min = {...points[0]};
  const max = {...points[0]};
  for (const point of points) {
    min.x = Math.min(min.x,point.x);
    min.y = Math.min(min.y,point.y);
    max.x = Math.max(max.x,point.x);
    max.y = Math.max(max.y,point.y);
  }
  return {min,max};
}

function cubicExtrema(a:number,b:number,c:number,d:number): number[] {
  const quadratic = -a+3*b-3*c+d;
  const linear = 2*(a-2*b+c);
  const constant = b-a;
  if (Math.abs(quadratic) < 1e-10) {
    return Math.abs(linear) < 1e-10 ? [] : [-constant/linear];
  }
  const discriminant = linear*linear-4*quadratic*constant;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-linear+root)/(2*quadratic),(-linear-root)/(2*quadratic)];
}

function cubicValue(a:number,b:number,c:number,d:number,t:number): number {
  const u = 1-t;
  return u*u*u*a+3*u*u*t*b+3*u*t*t*c+t*t*t*d;
}

export function worldPartBounds(part:VectorPart,poses:Map<string,BonePose>): Bounds {
  if (part.facets) return pointBounds(facetArtworkFaces(part,poses).flatMap(face=>face.polygons.flat()));
  if (part.mesh) return pointBounds(deformMesh(part,poses));
  const world = (point:Point) => partWorldSpace(point,part,poses);
  const points = contourBoundsPoints(part.knots,part.closed,world);
  for (const contour of part.contours ?? []) points.push(...contourBoundsPoints(contour,true,world));
  return pointBounds(points);
}

function contourBoundsPoints(knots:VectorKnot[],closed:boolean,world:(point:Point)=>Point) {
  const points = knots.map(knot=>world(knot.point));
  for (let index=0;index<(closed ? knots.length : knots.length-1);index++) {
    const next = (index+1)%knots.length;
    const first = knots[index].outgoing;
    const last = knots[next].incoming;
    if (!first && !last) continue;
    const start = points[index];
    const end = points[next];
    const a = first ? world(first) : start;
    const b = last ? world(last) : end;
    const times = [...cubicExtrema(start.x,a.x,b.x,end.x),...cubicExtrema(start.y,a.y,b.y,end.y)];
    for (const t of times) if (t>0 && t<1) points.push({
      x:cubicValue(start.x,a.x,b.x,end.x,t),y:cubicValue(start.y,a.y,b.y,end.y,t),
    });
  }
  return points;
}

export function translatedPartOffset(part:VectorPart,delta:Point,poses:Map<string,BonePose>): Point {
  const origin = partParentSpace({x:0,y:0},part,poses);
  const target = partParentSpace(delta,part,poses);
  return {x:part.offset.x+target.x-origin.x,y:part.offset.y+target.y-origin.y};
}

export function boundAnchor(bounds:Bounds,axis:Axis,anchor:Anchor): number {
  if (anchor === "center") return (bounds.min[axis]+bounds.max[axis])/2;
  return bounds[anchor][axis];
}

export function layoutOffsets(parts:readonly VectorPart[],poses:Map<string,BonePose>,axis:Axis,anchor?:Anchor) {
  const items = parts.map(part=>({part,bounds:worldPartBounds(part,poses)}));
  const merged = pointBounds(items.flatMap(item=>[item.bounds.min,item.bounds.max]));
  const translated = (part:VectorPart,distance:number) => ({
    id:part.id,offset:translatedPartOffset(part,{x:axis==="x"?distance:0,y:axis==="y"?distance:0},poses),
  });
  if (anchor) {
    const target = boundAnchor(merged,axis,anchor);
    return items.map(item=>translated(item.part,target-boundAnchor(item.bounds,axis,anchor)));
  }
  items.sort((a,b)=>a.bounds.min[axis]-b.bounds.min[axis]);
  const span = items.reduce((sum,item)=>sum+item.bounds.max[axis]-item.bounds.min[axis],0);
  const gap = (merged.max[axis]-merged.min[axis]-span)/(items.length-1);
  let left = merged.min[axis];
  return items.map(({part,bounds})=>{
    const offset = translated(part,left-bounds.min[axis]);
    left += bounds.max[axis]-bounds.min[axis]+gap;
    return offset;
  });
}

export function pointInPolygon(point:Point,polygon:readonly Point[]): boolean {
  let inside = false;
  for (let first=0,last=polygon.length-1;first<polygon.length;last=first++) {
    const a = polygon[first];
    const b = polygon[last];
    if ((a.y>point.y)!==(b.y>point.y) &&
      point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x) inside = !inside;
  }
  return inside;
}
