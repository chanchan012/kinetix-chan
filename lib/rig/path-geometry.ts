import type { Point, VectorKnot, VectorPart } from "./model";
import { mapPartPoint, partMatrix, unmapPartPoint } from "./part-transform";

export const primitiveShapes = ["rectangle","ellipse","star"] as const;
export type PrimitiveShape = typeof primitiveShapes[number];
export type KnotHandle = "point" | "incoming" | "outgoing";

export function primitiveKnots(shape:PrimitiveShape, from:Point, to:Point, square:boolean): VectorKnot[] {
  const delta = {x:to.x-from.x,y:to.y-from.y};
  const size = Math.min(Math.abs(delta.x),Math.abs(delta.y));
  const end = square ? {x:from.x + Math.sign(delta.x)*size,y:from.y + Math.sign(delta.y)*size} : to;
  const x = Math.min(from.x,end.x);
  const y = Math.min(from.y,end.y);
  const width = Math.abs(end.x-from.x);
  const height = Math.abs(end.y-from.y);
  const rx = width/2;
  const ry = height/2;
  const cx = x+rx;
  const cy = y+ry;
  const knot = (x:number,y:number): VectorKnot => ({point:{x,y}});
  if (shape === "rectangle") return [knot(x,y),knot(x+width,y),knot(x+width,y+height),knot(x,y+height)];
  if (shape === "star") return Array.from({length:10},(_,index) => {
    const angle = index * Math.PI/5 - Math.PI/2;
    const length = index % 2 ? 0.45 : 1;
    return knot(cx + Math.cos(angle)*rx*length,cy + Math.sin(angle)*ry*length);
  });
  const kappa = 4*(Math.SQRT2-1)/3;
  const tx = rx*kappa;
  const ty = ry*kappa;
  return [
    {point:{x:cx,y},incoming:{x:cx-tx,y},outgoing:{x:cx+tx,y},mode:"smooth"},
    {point:{x:x+width,y:cy},incoming:{x:x+width,y:cy-ty},outgoing:{x:x+width,y:cy+ty},mode:"smooth"},
    {point:{x:cx,y:y+height},incoming:{x:cx+tx,y:y+height},outgoing:{x:cx-tx,y:y+height},mode:"smooth"},
    {point:{x,y:cy},incoming:{x,y:cy+ty},outgoing:{x,y:cy-ty},mode:"smooth"},
  ];
}

const midpoint = (a:Point,b:Point):Point => ({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
const lengthBetween = (a:Point,b:Point) => Math.hypot(a.x-b.x,a.y-b.y);

/** Subdivide a segment at t = 0.5 while keeping its exact curve. */
export function splitPathEdge(part:VectorPart, edge:number): VectorKnot[] {
  const count = part.knots.length;
  if (edge >= (part.closed ? count : count-1)) throw new Error("This edge does not exist.");
  const destination = (edge+1) % count;
  const start = part.knots[edge];
  const end = part.knots[destination];
  const knots = part.knots.slice();
  if (!start.outgoing && !end.incoming) {
    knots.splice(edge+1,0,{point:midpoint(start.point,end.point)});
    return knots;
  }
  const first = start.outgoing ?? start.point;
  const last = end.incoming ?? end.point;
  const a = midpoint(start.point,first);
  const b = midpoint(first,last);
  const c = midpoint(last,end.point);
  const incoming = midpoint(a,b);
  const outgoing = midpoint(b,c);
  knots[edge] = {...start,outgoing:a};
  knots[destination] = {...end,incoming:c};
  knots.splice(edge+1,0,{point:midpoint(incoming,outgoing),incoming,outgoing,mode:"smooth"});
  return knots;
}

export function changeNodeMode(part:VectorPart, index:number, mode:"corner"|"smooth"): VectorKnot[] {
  const current = part.knots[index];
  if (!current) throw new Error("This path node does not exist.");
  const {point} = current;
  const previous = part.knots[index-1] ?? (part.closed ? part.knots.at(-1) : undefined);
  const next = part.knots[index+1] ?? (part.closed ? part.knots[0] : undefined);
  const from = previous?.point ?? point;
  const to = next?.point ?? point;
  const line = lengthBetween(from,to);
  if (mode === "corner" || line === 0) return part.knots.map((knot,i) => i === index ? {point,mode} : knot);
  const handle = (length:number):Point => ({x:point.x+(to.x-from.x)*length/line,y:point.y+(to.y-from.y)*length/line});
  const incoming = previous ? handle(-lengthBetween(from,point)/3) : undefined;
  const outgoing = next ? handle(lengthBetween(point,to)/3) : undefined;
  return part.knots.map((knot,i) => i === index ? {point,incoming,outgoing,mode} : knot);
}

export function reverseKnots(knots:readonly VectorKnot[]): VectorKnot[] {
  return knots.toReversed().map(knot => ({...knot,incoming:knot.outgoing,outgoing:knot.incoming}));
}

export function movePathKnot(knot:VectorKnot,handle:KnotHandle,target:Point): VectorKnot {
  const {point} = knot;
  if (handle==="point") {
    const translate = (item:Point) => ({x:item.x+target.x-point.x,y:item.y+target.y-point.y});
    return {...knot,point:target,incoming:knot.incoming && translate(knot.incoming),outgoing:knot.outgoing && translate(knot.outgoing)};
  }
  const other = handle==="incoming" ? "outgoing" : "incoming";
  const moved = {...knot,[handle]:target};
  const opposite = knot[other];
  const length = lengthBetween(point,target);
  if (knot.mode==="smooth" && opposite && length>0) {
    const ratio = lengthBetween(point,opposite)/length;
    moved[other] = {x:point.x-(target.x-point.x)*ratio,y:point.y-(target.y-point.y)*ratio};
  }
  return moved;
}

export function joinOpenParts(target:VectorPart, source:VectorPart): VectorKnot[] {
  if (target.id === source.id || target.closed || source.closed || target.parentId !== source.parentId) {
    throw new Error("Choose two open paths attached to the same parent.");
  }
  const targetMatrix = partMatrix(target);
  const sourceMatrix = partMatrix(source);
  const convert = (point:Point) => unmapPartPoint(targetMatrix,mapPartPoint(sourceMatrix,point));
  const mapped = source.knots.map(({point,incoming,outgoing,mode}) => ({
    point:convert(point), incoming:incoming && convert(incoming), outgoing:outgoing && convert(outgoing),mode,
  }));
  const end = target.knots.at(-1)!;
  const endpoint = mapPartPoint(targetMatrix,end.point);
  const forward = lengthBetween(endpoint,mapPartPoint(sourceMatrix,source.knots[0].point)) <=
    lengthBetween(endpoint,mapPartPoint(sourceMatrix,source.knots.at(-1)!.point));
  const [start,...rest] = forward ? mapped : reverseKnots(mapped);
  if (lengthBetween(end.point,start.point) < 1e-6) {
    return [...target.knots.slice(0,-1),{...end,outgoing:start.outgoing},...rest];
  }
  return [...target.knots.slice(0,-1),{...end,outgoing:undefined},{...start,incoming:undefined},...rest];
}

/** Distance from a point to a finite line segment in document coordinates. */
function segmentGap(point:Point,start:Point,end:Point) {
  const x = end.x-start.x;
  const y = end.y-start.y;
  const size = x*x+y*y;
  if (!size) return lengthBetween(point,start);
  const fraction = Math.min(1,Math.max(0,((point.x-start.x)*x+(point.y-start.y)*y)/size));
  return lengthBetween(point,{x:start.x+x*fraction,y:start.y+y*fraction});
}

export function simplifyOpenPoints(points:readonly Point[], tolerance:number): Point[] {
  if (points.length < 3) return [...points];
  let split = -1;
  let distance = tolerance;
  for (let i=1;i<points.length-1;i++) {
    const gap = segmentGap(points[i],points[0],points.at(-1)!);
    if (gap > distance) {
      split = i;
      distance = gap;
    }
  }
  if (split < 0) return [points[0],points.at(-1)!];
  return [...simplifyOpenPoints(points.slice(0,split+1),tolerance).slice(0,-1),
    ...simplifyOpenPoints(points.slice(split),tolerance)];
}

/** Reduce straight sections while keeping the endpoints and handles of every cubic segment. */
export function simplifyPath(part:VectorPart,tolerance:number): VectorKnot[] {
  const knots = part.closed ? [...part.knots,part.knots[0]] : part.knots;
  const result = [knots[0]];
  let start = 0;
  function addStraightRun(end:number) {
    const middle = knots.slice(start,end+1);
    if (middle.length < 2) return;
    const kept = new Set(simplifyOpenPoints(middle.map(knot=>knot.point),tolerance));
    result.push(...middle.slice(1).filter(knot=>kept.has(knot.point)));
  }
  for (let i=0;i<knots.length-1;i++) {
    if (!knots[i].outgoing && !knots[i+1].incoming) continue;
    addStraightRun(i);
    result.push(knots[i+1]);
    start = i+1;
  }
  addStraightRun(knots.length-1);
  if (part.closed) result.pop();
  return result.length >= (part.closed ? 3 : 2) ? result : part.knots;
}

export function pencilKnots(points:readonly Point[], tolerance:number): VectorKnot[] {
  let reduced = simplifyOpenPoints(points,tolerance);
  while (reduced.length > 256) {
    tolerance *= 1.5;
    reduced = simplifyOpenPoints(points,tolerance);
  }
  return reduced.map((point,index) => {
    const previous = reduced[index-1] ?? point;
    const next = reduced[index+1] ?? point;
    const dx = (next.x-previous.x)/6;
    const dy = (next.y-previous.y)/6;
    return {point,mode:"smooth",
      ...(index > 0 && {incoming:{x:point.x-dx,y:point.y-dy}}),
      ...(index < reduced.length-1 && {outgoing:{x:point.x+dx,y:point.y+dy}}),
    };
  });
}
