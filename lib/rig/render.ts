import { drawStudy } from "../artwork";
import type { BonePose } from "./kinematics";
import { createRigState, type KinetixRigState, type Point, type VectorPart } from "./model";
import { deformMesh } from "./skinning";
import { partMatrix } from "./part-transform";
import { facetArtworkFaces } from "./facet-skinning";

export const viewportFrame = {x:-10,y:3,width:510,height:280};
export const viewportFrameFor = (rig: KinetixRigState) => rig.version === 1 ? viewportFrame :
  { x: 0, y: 0, width: rig.artboard.width, height: rig.artboard.height };

export type RigDrawingContext = Pick<CanvasRenderingContext2D,
  "arc" | "beginPath" | "bezierCurveTo" | "closePath" | "fill" | "lineTo" |
  "lineWidth" | "moveTo" | "restore" | "rotate" | "save" | "stroke" | "transform" | "translate"
> & { fillStyle: unknown; strokeStyle: unknown };

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
  const first = part.knots[0];
  context.beginPath();
  context.moveTo(first.point.x, first.point.y);
  const segments = part.closed ? part.knots.length : part.knots.length - 1;
  for (let index = 0; index < segments; index++) {
    const start = part.knots[index];
    const end = part.knots[(index + 1) % part.knots.length];
    if (start.outgoing || end.incoming) {
      const a = start.outgoing ?? start.point;
      const b = end.incoming ?? end.point;
      context.bezierCurveTo(a.x, a.y, b.x, b.y, end.point.x, end.point.y);
    } else {
      context.lineTo(end.point.x, end.point.y);
    }
  }
  if (part.closed) context.closePath();
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

export function drawRigArtwork(
  context: RigDrawingContext, rig: KinetixRigState, poses: Map<string, BonePose>, phase: number,
  reference = true,
) {
  if (reference && rig.study) {
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
  for (const part of rig.parts) {
    if (part.facets) {
      const faces = facetArtworkFaces(part,poses);
      tracePolygons(context,faces.flatMap(face=>face.polygons));
      context.fillStyle = faces[0].fill;
      context.fill();
      for (const face of faces) {
        tracePolygons(context,face.polygons);
        context.fillStyle = face.fill;
        context.fill();
      }
      continue;
    }
    if (part.mesh) {
      traceMesh(context, deformMesh(part, poses), part.mesh.triangles);
      context.fillStyle = part.fill;
      context.fill();
      continue;
    }
    inPartSpace(context, part, poses, () => tracePart(context, part));
    if (part.closed) {
      context.fillStyle = part.fill;
      context.fill();
    } else {
      context.strokeStyle = part.fill;
      context.lineWidth = 2;
      context.stroke();
    }
  }
}
