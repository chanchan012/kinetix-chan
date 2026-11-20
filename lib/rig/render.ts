import { drawStudy } from "../artwork";
import type { BonePose } from "./kinematics";
import { createRigState, type KinetixRigState, type Point, type VectorKnot, type VectorPart } from "./model";
import { deformMesh } from "./skinning";
import { partMatrix } from "./part-transform";
import { facetArtworkFaces } from "./facet-skinning";
import { orderedLayers,orderedVisibleParts } from "./layer-tree";
import { defaultStroke,gradientAxis,resolvePaint,type Paint,type Swatch } from "./appearance";
import { intersectRegions,pathRegions,regionPolygons } from "./path-boolean";

export const viewportFrame = {x:-10,y:3,width:510,height:280};
export const viewportFrameFor = (rig: KinetixRigState) => rig.version === 1 ? viewportFrame :
  { x: 0, y: 0, width: rig.artboard.width, height: rig.artboard.height };

export type RigDrawingContext = Pick<CanvasRenderingContext2D,
  "arc" | "beginPath" | "bezierCurveTo" | "closePath" | "lineTo" | "globalAlpha" |
  "lineWidth" | "lineCap" | "lineJoin" | "miterLimit" | "lineDashOffset" | "setLineDash" |
  "moveTo" | "restore" | "rotate" | "save" | "stroke" | "transform" | "translate"
> & {
  fillStyle: unknown; strokeStyle: unknown;
  createLinearGradient(x0:number,y0:number,x1:number,y1:number):Pick<CanvasGradient,"addColorStop">;
  fill(rule?:CanvasFillRule):void;
  clip(rule?:CanvasFillRule):void;
};

export function drawArtboardBackground(context: RigDrawingContext, rig: KinetixRigState) {
  if (rig.version !== 2 || !rig.artboard.background) return;
  const { width, height, background } = rig.artboard;
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(width, 0);
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fillStyle = background;
  context.fill();
}

export function tracePart(context: RigDrawingContext, part: VectorPart) {
  context.beginPath();
  traceContour(context,part.knots,part.closed);
  for (const contour of part.contours ?? []) traceContour(context,contour,true);
}

function traceContour(context:RigDrawingContext,knots:VectorKnot[],closed:boolean) {
  const first = knots[0];
  context.moveTo(first.point.x, first.point.y);
  const segments = closed ? knots.length : knots.length - 1;
  for (let index = 0; index < segments; index++) {
    const start = knots[index];
    const end = knots[(index + 1) % knots.length];
    if (start.outgoing || end.incoming) {
      const a = start.outgoing ?? start.point;
      const b = end.incoming ?? end.point;
      context.bezierCurveTo(a.x, a.y, b.x, b.y, end.point.x, end.point.y);
    } else {
      context.lineTo(end.point.x, end.point.y);
    }
  }
  if (closed) context.closePath();
}

export function inPartSpace(
  context: RigDrawingContext, part: VectorPart, poses: Map<string, BonePose>, draw: () => void,
) {
  context.save();
  const parent = part.parentId === null ? undefined : poses.get(part.parentId);
  if (parent) {
    context.translate(parent.origin.x, parent.origin.y);
    context.rotate(parent.angle);
  }
  context.transform(...partMatrix(part));
  draw();
  context.restore();
}

export function traceMesh(context: RigDrawingContext, points: Point[], triangles: NonNullable<VectorPart["mesh"]>["triangles"]) {
  context.beginPath();
  for (const [a, b, c] of triangles) {
    context.moveTo(points[a].x, points[a].y);
    context.lineTo(points[b].x, points[b].y);
    context.lineTo(points[c].x, points[c].y);
    context.closePath();
  }
}

export function tracePolygons(context:RigDrawingContext,polygons:readonly (readonly Point[])[]) {
  context.beginPath();
  for (const polygon of polygons) {
    context.moveTo(polygon[0].x,polygon[0].y);
    for (const point of polygon.slice(1)) context.lineTo(point.x,point.y);
    context.closePath();
  }
}

function styleFor(context:RigDrawingContext,part:VectorPart,paint:Paint,poses:Map<string,BonePose>,swatches:readonly Swatch[]) {
  const value = resolvePaint(paint,swatches);
  if (value.kind==="solid") return value.color;
  const [from,to] = gradientAxis(part,value,poses);
  const gradient = context.createLinearGradient(from.x,from.y,to.x,to.y);
  for (const stop of value.stops) gradient.addColorStop(stop.offset,stop.color);
  return gradient;
}

export function partMasks(rig:KinetixRigState) {
  const masks = new Map<string,string[]>();
  if (rig.layers) for (const {node,masks:stack} of orderedLayers(rig.layers)) {
    if (node.kind==="part" && stack.length) masks.set(node.partId,stack);
  }
  return masks;
}

export function maskRegions(parts:Map<string,VectorPart>,ids:readonly string[],poses:Map<string,BonePose>,
  cached:Map<string,ReturnType<typeof pathRegions>>) {
  const shapes = ids.map(id=>{
    const known = cached.get(id);
    if (known) return known;
    const geometry = pathRegions(parts.get(id)!,poses);
    cached.set(id,geometry);
    return geometry;
  });
  return shapes.reduce(intersectRegions);
}

export function drawRigArtwork(
  context: RigDrawingContext, rig: KinetixRigState, poses: Map<string, BonePose>, phase: number,
  reference = true, isolate?:string|null,
) {
  if (reference && !isolate && rig.study) {
    const root = poses.get("root");
    const rest = createRigState(rig.study).bones[0].offset;
    context.save();
    if (root) {
      context.translate(root.origin.x, root.origin.y);
      context.rotate(root.angle);
      context.translate(-rest.x, -rest.y);
    }
    drawStudy(context, rig.study, phase, false);
    context.restore();
  }
  const masks = partMasks(rig);
  const byId = new Map(rig.parts.map(part=>[part.id,part]));
  const cached = new Map<string,ReturnType<typeof pathRegions>>();
  const swatches = rig.swatches ?? [];
  for (const part of orderedVisibleParts(rig,isolate)) {
    context.save();
    const stack = masks.get(part.id);
    if (stack) {
      tracePolygons(context,regionPolygons(maskRegions(byId,stack,poses,cached)));
      context.clip("evenodd");
    }
    const appearance = part.appearance;
    const opacity = appearance?.opacity ?? 1;
    context.globalAlpha *= opacity;
    const fill = appearance?.fill === undefined ? {kind:"solid" as const,color:part.fill} : appearance.fill;
    const stroke = appearance?.stroke === undefined && !part.closed ? defaultStroke(part.fill) : appearance?.stroke;
    if (part.facets && appearance?.fill===undefined) {
      const faces = facetArtworkFaces(part,poses);
      if (opacity===1) {
        tracePolygons(context,faces.flatMap(face=>face.polygons));
        context.fillStyle = faces[0].fill;
        context.fill();
      }
      for (const face of faces) {
        tracePolygons(context,face.polygons);
        context.fillStyle = face.fill;
        context.fill();
      }
    } else {
      if (part.facets) tracePolygons(context,facetArtworkFaces(part,poses).flatMap(face=>face.polygons));
      else if (part.mesh) traceMesh(context,deformMesh(part,poses),part.mesh.triangles);
      else inPartSpace(context,part,poses,()=>tracePart(context,part));
      if (part.closed && fill) {
        context.fillStyle = styleFor(context,part,fill,poses,swatches);
        context.fill(part.contours ? "evenodd" : "nonzero");
      }
    }
    if (stroke) {
      if (part.facets || part.mesh) tracePolygons(context,regionPolygons(pathRegions(part,poses)));
      context.strokeStyle = styleFor(context,part,stroke.paint,poses,swatches);
      context.lineWidth = stroke.width;
      context.lineCap = stroke.cap;
      context.lineJoin = stroke.join;
      context.miterLimit = stroke.miter;
      context.setLineDash(stroke.dash);
      context.lineDashOffset = stroke.offset ?? 0;
      context.stroke();
    }
    context.restore();
  }
}
