import { drawStudy } from "../artwork";
import { rotatePoint, type BonePose } from "./kinematics";
import { createRigState, type KinetixRigState, type Point, type VectorPart } from "./model";
import { deformMesh } from "./skinning";

export function partSpace(point: Point, part: VectorPart, poses: Map<string, BonePose>): Point {
  const parent = part.parentId === null ? undefined : poses.get(part.parentId);
  const local = parent ? rotatePoint({ x: point.x - parent.origin.x, y: point.y - parent.origin.y }, -parent.angle) : point;
  return { x: local.x - part.offset.x, y: local.y - part.offset.y };
}

export function tracePart(context: CanvasRenderingContext2D, part: VectorPart) {
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
  context: CanvasRenderingContext2D, part: VectorPart, poses: Map<string, BonePose>, draw: () => void,
) {
  context.save();
  const parent = part.parentId === null ? undefined : poses.get(part.parentId);
  if (parent) {
    context.translate(parent.origin.x, parent.origin.y);
    context.rotate(parent.angle);
  }
  context.translate(part.offset.x, part.offset.y);
  draw();
  context.restore();
}

export function traceMesh(context: CanvasRenderingContext2D, points: Point[], triangles: NonNullable<VectorPart["mesh"]>["triangles"]) {
  context.beginPath();
  for (const [a, b, c] of triangles) {
    context.moveTo(points[a].x, points[a].y);
    context.lineTo(points[b].x, points[b].y);
    context.lineTo(points[c].x, points[c].y);
    context.closePath();
  }
}

export function drawRigArtwork(
  context: CanvasRenderingContext2D, rig: KinetixRigState, poses: Map<string, BonePose>, phase: number,
  reference = true,
) {
  if (reference) {
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
    if (part.mesh) {
      traceMesh(context, deformMesh(part, poses), part.mesh.triangles);
      context.fillStyle = part.fill;
      context.fill();
      continue;
    }
    inPartSpace(context, part, poses, () => {
      tracePart(context, part);
      if (part.closed) {
        context.fillStyle = part.fill;
        context.fill();
      } else {
        context.strokeStyle = part.fill;
        context.lineWidth = 2;
        context.stroke();
      }
    });
  }
}
