"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { evaluateRig, rotatePoint } from "@/lib/rig/kinematics";
import type { KinetixRigState, Point, VectorKnot, VectorPart } from "@/lib/rig/model";
import { drawArtboardBackground, drawRigArtwork, inPartSpace, partSpace, traceMesh, tracePart, viewportFrameFor } from "@/lib/rig/render";
import { deformMesh, paintMesh } from "@/lib/rig/skinning";
import type { RigCommand } from "@/lib/rig/commands";

export type Selection = { kind: "bone" | "part"; id: string } | null;
export type Tool = "select" | "bone" | "pen" | "polygon";
export type Brush = { partId: string; boneId: string; radius: number; strength: number };
type PointKind = keyof VectorKnot;
type Gesture =
  | { type: "rotate"; id: string; origin: Point; start: number; rotation: number }
  | { type: "target"; id: string }
  | { type: "bone"; start: Point }
  | { type: "pen" | "polygon"; start: Point }
  | { type: "move"; part: VectorPart; start: Point }
  | { type: "knot"; part: VectorPart; index: number; handle: PointKind }
  | { type: "paint"; part: VectorPart; last: Point; brush: Brush };

type Props = {
  rig: KinetixRigState;
  phase: number;
  ghosts: { rig: KinetixRigState; phase: number }[];
  brush: Brush | null;
  remoteBones: ReadonlySet<string>;
  selected: Selection;
  selectedEdge: number;
  select: (value: Selection) => void;
  tool: Tool;
  reference: boolean;
  zoom: number;
  showBones: boolean;
  pen: VectorKnot[];
  addKnot: (knot: VectorKnot) => void;
  closePolygon: () => void;
  addBone: (from: Point, to: Point) => void;
  edit: (label: string, command: RigCommand) => void;
};

const angleAt = (point: Point, origin: Point) => Math.atan2(point.y - origin.y, point.x - origin.x);
const distance = (left: Point, right: Point) => Math.hypot(left.x - right.x, left.y - right.y);

function segmentDistance(point: Point, start: Point, end: Point) {
  const x = end.x - start.x;
  const y = end.y - start.y;
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * x + (point.y - start.y) * y) / (x * x + y * y)));
  return distance(point, { x: start.x + x * ratio, y: start.y + y * ratio });
}

function circle(context: CanvasRenderingContext2D, point: Point, radius: number) {
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
}

export function Viewport({rig, phase, ghosts, brush, remoteBones, selected, selectedEdge, select, tool, reference, zoom, showBones, pen, addKnot, closePolygon, addBone, edit}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const authoredPoses = useMemo(() => evaluateRig(rig), [rig]);
  const viewportFrame = viewportFrameFor(rig);
  const scale = Math.min(size.width / viewportFrame.width, size.height / viewportFrame.height) * zoom;
  const camera = {
    x: size.width / 2 - (viewportFrame.x + viewportFrame.width / 2) * scale,
    y: size.height / 2 - (viewportFrame.y + viewportFrame.height / 2) * scale,
  };

  useEffect(() => {
    const element = canvas.current!;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function worldPoint(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left - camera.x) / scale, y: (event.clientY - rect.top - camera.y) / scale };
  }

  function gestureCommand(current: Gesture, point: Point): RigCommand | undefined {
    switch (current.type) {
      case "rotate": {
        const shift = angleAt(point, current.origin) - current.start;
        const rotation = current.rotation + Math.atan2(Math.sin(shift), Math.cos(shift));
        return { type: "bone.update", id: current.id, changes: { rotation } };
      }
      case "target":
        return { type: "ik.target", id: current.id, target: point };
      case "paint":
        return { type: "part.update", id: current.part.id, changes: { mesh: current.part.mesh } };
      case "move": {
        const start = partSpace(current.start, current.part, authoredPoses);
        const local = partSpace(point, current.part, authoredPoses);
        return { type: "part.update", id: current.part.id, changes: {
          offset: { x: current.part.offset.x + local.x - start.x, y: current.part.offset.y + local.y - start.y },
        } };
      }
      case "knot": {
        const knots = current.part.knots.map((knot, index) => {
          if (index !== current.index) return knot;
          const local = partSpace(point, current.part, authoredPoses);
          if (current.handle !== "point") return { ...knot, [current.handle]: local };
          const shift = (handle: Point) => ({
            x: handle.x + local.x - knot.point.x, y: handle.y + local.y - knot.point.y,
          });
          return {
            point: local,
            ...(knot.incoming && { incoming: shift(knot.incoming) }),
            ...(knot.outgoing && { outgoing: shift(knot.outgoing) }),
          };
        });
        return { type: "part.update", id: current.part.id, changes: { knots } };
      }
    }
  }

  const draft = gesture && cursor ? gestureCommand(gesture, cursor) : undefined;
  const preview: KinetixRigState = draft?.type === "bone.update" ? {
    ...rig, bones: rig.bones.map(bone => bone.id === draft.id ? { ...bone, ...draft.changes } : bone),
  } : draft?.type === "ik.target" ? {
    ...rig, constraints: rig.constraints.map(ik => ik.id === draft.id ? { ...ik, target: draft.target } : ik),
  } : draft?.type === "part.update" ? {
    ...rig, parts: rig.parts.map(part => part.id === draft.id ? { ...part, ...draft.changes } : part),
  } : rig;

  useEffect(() => {
    if (!scale) return;
    const element = canvas.current!;
    const frame = requestAnimationFrame(() => {
      const context = element.getContext("2d");
      if (!context) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const pixelWidth = Math.round(size.width * dpr);
      const pixelHeight = Math.round(size.height * dpr);
      if (element.width !== pixelWidth) element.width = pixelWidth;
      if (element.height !== pixelHeight) element.height = pixelHeight;
      context.resetTransform();
      context.clearRect(0, 0, element.width, element.height);
      context.setTransform(scale * dpr, 0, 0, scale * dpr, camera.x * dpr, camera.y * dpr);
      const poses = preview === rig ? authoredPoses : evaluateRig(preview);
      context.save();
      if (rig.version === 2) {
        const {width, height} = rig.artboard;
        context.strokeStyle = "#726d638f";
        context.lineWidth = 1 / scale;
        context.strokeRect(0, 0, width, height);
        context.beginPath();
        context.rect(0, 0, width, height);
        context.clip();
        drawArtboardBackground(context, rig);
      }
      if (ghosts.length) {
        context.save();
        context.globalAlpha = 0.19;
        for (const ghost of ghosts) drawRigArtwork(context, ghost.rig, evaluateRig(ghost.rig), ghost.phase, reference);
        context.restore();
      }
      drawRigArtwork(context, preview, poses, phase, reference);
      context.restore();
      const pixel = 1 / scale;
      context.lineWidth = 1.5 * pixel;

      if (showBones) for (const [id, pose] of poses) {
        const active = selected?.kind === "bone" && selected.id === id;
        const remote = remoteBones.has(id);
        context.strokeStyle = active ? "#a93716" : remote ? "#1e6b61" : "#474b43";
        context.fillStyle = active ? "#f78355" : remote ? "#85bfad" : "#fffcef";
        context.beginPath();
        context.moveTo(pose.origin.x, pose.origin.y);
        context.lineTo(pose.tip.x, pose.tip.y);
        context.stroke();
        circle(context, pose.origin, 4 * pixel);
        circle(context, pose.tip, (active ? 6 : 3) * pixel);
      }
      if (showBones) for (const constraint of preview.constraints) {
        if (constraint.enabled === false) continue;
        context.fillStyle = "#fffcef";
        context.strokeStyle = "#136e68";
        circle(context, constraint.target, 6 * pixel);
      }
      const part = selected?.kind === "part" ? preview.parts.find(item => item.id === selected.id) : undefined;
      if (part?.mesh) {
        const points = deformMesh(part, poses);
        traceMesh(context, points, part.mesh.triangles);
        context.strokeStyle = brush ? "#28566cb5" : "#534c43a6";
        context.stroke();
        if (brush) for (const [index, point] of points.entries()) {
          const weight = part.mesh.vertices[index].weights.find(influence => influence.boneId === brush.boneId)?.weight ?? 0;
          context.fillStyle = `hsl(${220 - 205 * weight} 78% 55%)`;
          circle(context, point, 3 * pixel);
        }
      } else if (part) inPartSpace(context, part, poses, () => {
        context.strokeStyle = "#a93716";
        context.fillStyle = "#fffcef";
        tracePart(context, part);
        context.stroke();
        const edge = part.knots[selectedEdge];
        const end = part.knots[(selectedEdge + 1) % part.knots.length];
        if (edge && !edge.outgoing && !end.incoming) {
          context.save();
          context.strokeStyle = "#216885";
          context.lineWidth = 3 * pixel;
          context.beginPath();
          context.moveTo(edge.point.x, edge.point.y);
          context.lineTo(end.point.x, end.point.y);
          context.stroke();
          context.restore();
        }
        for (const knot of part.knots) {
          for (const handle of [knot.incoming, knot.outgoing]) {
            if (!handle) continue;
            context.beginPath();
            context.moveTo(knot.point.x, knot.point.y);
            context.lineTo(handle.x, handle.y);
            context.stroke();
            circle(context, handle, 3 * pixel);
          }
          circle(context, knot.point, 4 * pixel);
        }
      });

      context.strokeStyle = "#a93716";
      context.fillStyle = "#f78355";
      if (gesture?.type === "bone" && cursor) {
        context.beginPath();
        context.moveTo(gesture.start.x, gesture.start.y);
        context.lineTo(cursor.x, cursor.y);
        context.stroke();
      }
      if (brush && cursor) {
        context.beginPath();
        context.strokeStyle = "#164e6e";
        context.arc(cursor.x, cursor.y, brush.radius, 0, Math.PI * 2);
        context.stroke();
      }
      const knots = gesture?.type === "pen" && cursor ? [...pen, penKnot(gesture.start, cursor, pixel)] : pen;
      if (knots.length) {
        tracePart(context, { id: "", name: "", parentId: null, offset: { x: 0, y: 0 }, knots, fill: "#f78355", closed: false });
        context.stroke();
        for (const knot of knots) circle(context, knot.point, 4 * pixel);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [scale, size, camera.x, camera.y, preview, rig, authoredPoses, phase, reference, selected, selectedEdge, showBones, gesture, cursor, pen, ghosts, brush, remoteBones]);

  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (!scale || event.button !== 0 || !event.isPrimary) return;
    const point = worldPoint(event);
    const tolerance = (event.pointerType === "touch" ? 15 : 10) / scale;
    let next: Gesture | undefined;
    if (brush) {
      const part = rig.parts.find(item => item.id === brush.partId);
      if (!part?.mesh) return;
      const mesh = paintMesh(part, authoredPoses, brush.boneId, point, brush.radius, brush.strength);
      next = { type: "paint", part: { ...part, mesh }, last: point, brush };
      setCursor(point);
    } else if (tool === "bone" || tool === "pen" || tool === "polygon") {
      next = { type: tool, start: point };
    } else {
      const part = selected?.kind === "part" ? rig.parts.find(item => item.id === selected.id) : undefined;
      if (part && !part.mesh) {
        const local = partSpace(point, part, authoredPoses);
        for (const [index, knot] of part.knots.entries()) {
          const handle = (["point", "incoming", "outgoing"] as const).find(key => knot[key] && distance(local, knot[key]) < tolerance);
          if (handle) { next = { type: "knot", part, index, handle }; break; }
        }
      }
      if (!next && showBones) {
        const target = rig.constraints.find(ik => distance(point, ik.target) < tolerance);
        if (target) next = { type: "target", id: target.id };
        const hits = rig.bones.map(bone => {
          const pose = authoredPoses.get(bone.id)!;
          return { bone, pose, distance: segmentDistance(point, pose.origin, pose.tip) };
        }).sort((a, b) => a.distance - b.distance);
        const hit = hits[0];
        if (!next && hit && hit.distance < tolerance) {
          select({ kind: "bone", id: hit.bone.id });
          const constraint = rig.constraints.find(ik => [ik.upperId, ik.lowerId].includes(hit.bone.id));
          next = constraint ? { type: "target", id: constraint.id } : {
            type: "rotate", id: hit.bone.id, start: angleAt(point, hit.pose.origin),
            rotation: hit.bone.rotation, origin: hit.pose.origin,
          };
        }
      }
      if (!next) {
        const context = event.currentTarget.getContext("2d")!;
        context.save();
        context.resetTransform();
        context.lineWidth = 2 * tolerance;
        const hit = [...rig.parts].reverse().find(item => {
          if (item.mesh) {
            traceMesh(context, deformMesh(item, authoredPoses), item.mesh.triangles);
            return context.isPointInPath(point.x, point.y);
          }
          const local = partSpace(point, item, authoredPoses);
          tracePart(context, item);
          return item.closed ? context.isPointInPath(local.x, local.y) : context.isPointInStroke(local.x, local.y);
        });
        context.restore();
        select(hit ? { kind: "part", id: hit.id } : null);
        if (hit) next = { type: "move", part: hit, start: point };
      }
    }
    if (!next) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture(next);
  }

  function end(event: PointerEvent<HTMLCanvasElement>) {
    if (!event.isPrimary || !gesture) return;
    const point = worldPoint(event);
    if (gesture.type === "bone") {
      if (distance(point, gesture.start) * scale > 4) addBone(gesture.start, point);
    } else if (gesture.type === "pen") {
      addKnot(penKnot(gesture.start, point, 1 / scale));
    } else if (gesture.type === "polygon") {
      const first = pen[0]?.point;
      const last = pen.at(-1)?.point;
      if (first && pen.length >= 3 && distance(gesture.start, first) * scale <= 9) closePolygon();
      else if (!last || distance(gesture.start, last) * scale > 1) addKnot({ point: gesture.start });
    } else if (cursor || gesture.type === "paint") {
      const command = gestureCommand(gesture, point);
      if (command) edit(gesture.type === "rotate" ? "Rotate bone" : gesture.type === "target" ? "Move IK target" :
        gesture.type === "paint" ? "Paint weights" : "Edit path", command);
    }
    clear();
  }

  function clear() { setGesture(null); setCursor(null); }

  return <canvas ref={canvas} className="studio-canvas" role="img" aria-label="Rig canvas" tabIndex={0}
    data-tool={brush ? "paint" : tool} onPointerDown={down} onPointerMove={event => {
      if (!event.isPrimary || !scale || (!gesture && !brush)) return;
      const point = worldPoint(event);
      if (gesture?.type === "paint" && distance(point, gesture.last) > gesture.brush.radius * 0.2) {
        const { part, brush: stroke } = gesture;
        const mesh = paintMesh(part, authoredPoses, stroke.boneId, point, stroke.radius, stroke.strength);
        setGesture({ ...gesture, last: point, part: { ...part, mesh } });
      }
      setCursor(point);
    }} onPointerLeave={() => { if (!gesture) setCursor(null); }} onPointerUp={end} onPointerCancel={clear} onLostPointerCapture={clear}/>;
}

function penKnot(start: Point, end: Point, pixel: number): VectorKnot {
  if (distance(start, end) < 4 * pixel) return { point: start };
  const reflected = rotatePoint({ x: end.x - start.x, y: end.y - start.y }, Math.PI);
  return { point: start, outgoing: end, incoming: { x: start.x + reflected.x, y: start.y + reflected.y } };
}
