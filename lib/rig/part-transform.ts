import type { Point, VectorPart } from "./model";
import { rotatePoint, type BonePose } from "./kinematics";

export type PartMatrix = [a:number,b:number,c:number,d:number,e:number,f:number];
const origin = { x:0, y:0 };

/** Map path coordinates to the parent plane while rotating and scaling around the local pivot. */
export function partMatrix(part:VectorPart): PartMatrix {
  const pivot = part.pivot ?? origin;
  const sx = part.scale?.x ?? 1;
  const sy = part.scale?.y ?? 1;
  const sin = Math.sin(part.rotation ?? 0);
  const cos = Math.cos(part.rotation ?? 0);
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  return [a,b,c,d,part.offset.x + pivot.x - a*pivot.x - c*pivot.y,
    part.offset.y + pivot.y - b*pivot.x - d*pivot.y];
}

export function mapPartPoint([a,b,c,d,e,f]:PartMatrix, {x,y}:Point): Point {
  return {x:a*x + c*y + e, y:b*x + d*y + f};
}

export function partParentSpace(point:Point, part:VectorPart, poses:Map<string,BonePose>): Point {
  const parent = part.parentId === null ? undefined : poses.get(part.parentId);
  return parent ? rotatePoint({x:point.x-parent.origin.x,y:point.y-parent.origin.y},-parent.angle) : point;
}

export function partSpace(point:Point, part:VectorPart, poses:Map<string,BonePose>): Point {
  return unmapPartPoint(partMatrix(part),partParentSpace(point,part,poses));
}

export function unmapPartPoint([a,b,c,d,e,f]:PartMatrix, parent:Point): Point {
  const determinant = a*d - b*c;
  const x = parent.x - e;
  const y = parent.y - f;
  return {x:(d*x-c*y)/determinant,y:(a*y-b*x)/determinant};
}

export function partWorldSpace(point:Point, part:VectorPart, poses:Map<string,BonePose>): Point {
  const local = mapPartPoint(partMatrix(part),point);
  const parent = part.parentId === null ? undefined : poses.get(part.parentId);
  if (!parent) return local;
  const rotated = rotatePoint(local,parent.angle);
  return { x:parent.origin.x+rotated.x, y:parent.origin.y+rotated.y };
}

export function offsetForPartPivot(part: VectorPart, pivot: Point): Point {
  const [, , , , beforeX, beforeY] = partMatrix(part);
  const [, , , , afterX, afterY] = partMatrix({...part,pivot});
  return {x:part.offset.x + (beforeX-afterX), y:part.offset.y + (beforeY-afterY)};
}
