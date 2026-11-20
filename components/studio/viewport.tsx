"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { evaluateRig, rotatePoint } from "@/lib/rig/kinematics";
import { artboardFor, type KinetixRigState, type Point, type VectorKnot, type VectorPart } from "@/lib/rig/model";
import { drawArtboardBackground, drawRigArtwork, inPartSpace, maskRegions, partMasks, traceMesh, tracePart, tracePolygons, viewportFrameFor } from "@/lib/rig/render";
import { partSpace, partWorldSpace } from "@/lib/rig/part-transform";
import { deformMesh, paintMesh } from "@/lib/rig/skinning";
import type { RigCommand } from "@/lib/rig/commands";
import { movePathKnot, pencilKnots, primitiveKnots, type KnotHandle, type PrimitiveShape } from "@/lib/rig/path-geometry";
import { pointBounds, pointInPolygon, translatedPartOffset, worldPartBounds, type Axis } from "@/lib/rig/path-layout";
import { facetArtworkFaces,facetPointMappers } from "@/lib/rig/facet-skinning";
import type { FacetViewportTool } from "./facet-tools";
import { editablePartIds,orderedVisibleParts } from "@/lib/rig/layer-tree";
import { regionPolygons } from "@/lib/rig/path-boolean";

export type Selection = { kind: "bone" | "part"; id: string } | null;
export type SelectionMode = "marquee" | "lasso";
export type Tool = "select" | "bone" | "pen" | "polygon" | "primitive" | "pencil" | "region" | "facet";
export type Brush = { partId: string; boneId: string; radius: number; strength: number };
type Gesture =
  | { type: "rotate"; id: string; origin: Point; start: number; rotation: number }
  | { type: "target"; id: string }
  | { type: "bone"; start: Point }
  | { type: "pen" | "polygon"; start: Point }
  | { type: "primitive"; start: Point; square: boolean }
  | { type: "pencil"; points: Point[] }
  | { type: "move"; part: VectorPart; ids:string[]; start: Point }
  | { type: "region"; points:Point[] }
  | { type: "knot"; part: VectorPart; index: number; handle: KnotHandle; start:Point }
  | { type: "facetVertex"; part:VectorPart; vertexId:string; start:Point }
  | { type: "paint"; part: VectorPart; last: Point; brush: Brush };

type Props = {
  rig: KinetixRigState;
  phase: number;
  ghosts: { rig: KinetixRigState; phase: number }[];
  brush: Brush | null;
  remoteBones: ReadonlySet<string>;
  selected: Selection;
  selectedParts: string[];
  selectedEdge: number;
  selectedNode: number;
  setNode: (index:number) => void;
  select: (value: Selection) => void;
  selectRegion: (ids:string[]) => void;
  tool: Tool;
  primitive: PrimitiveShape;
  facets: FacetViewportTool | null;
  isolation: string | null;
  smoothing: number;
  selectionMode: SelectionMode;
  snapping: boolean;
  rulers: boolean;
  reference: boolean;
  zoom: number;
  showBones: boolean;
  pen: VectorKnot[];
  addKnot: (knot: VectorKnot) => void;
  closePolygon: () => void;
  addDrawnPath: (closed:boolean,knots:VectorKnot[]) => void;
  addBone: (from: Point, to: Point) => void;
  edit: (label: string, command: RigCommand) => void;
};

const angleAt = (point: Point, origin: Point) => Math.atan2(point.y - origin.y, point.x - origin.x);
const distance = (left: Point, right: Point) => Math.hypot(left.x - right.x, left.y - right.y);
const nudges: Readonly<Record<string,Point>> = {
  ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0},ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1},
};
const noGuides: NonNullable<Extract<KinetixRigState,{version:2}>["guides"]> = [];

function segmentDistance(point: Point, start: Point, end: Point) {
  const x = end.x - start.x;
  const y = end.y - start.y;
  if (!x && !y) return distance(point,start);
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * x + (point.y - start.y) * y) / (x * x + y * y)));
  return distance(point, { x: start.x + x * ratio, y: start.y + y * ratio });
}

function circle(context: CanvasRenderingContext2D, point: Point, radius: number) {
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
}

function drawRulers(context:CanvasRenderingContext2D,camera:Point,scale:number,size:{width:number;height:number},dpr:number) {
  const width = 18;
  const interval = 60/scale;
  const power = 10 ** Math.floor(Math.log10(interval));
  const major = ([1,2,5,10].find(step=>step*power>=interval) ?? 10)*power;
  const minor = major/5;
  context.save();
  context.setTransform(dpr,0,0,dpr,0,0);
  context.fillStyle = "#f2efe4";
  context.fillRect(0,0,size.width,width);
  context.fillRect(0,0,width,size.height);
  context.fillStyle = "#5f5949";
  context.strokeStyle = "#9d947e";
  context.lineWidth = 1;
  context.font = "9px ui-monospace, monospace";
  context.beginPath();
  for (const axis of ["x","y"] as const) {
    const horizontal = axis==="x";
    const limit = horizontal ? size.width : size.height;
    for (let tick=Math.ceil((width-camera[axis])/(minor*scale)); tick*minor*scale+camera[axis]<limit; tick++) {
      const position = tick*minor*scale+camera[axis];
      const length = tick%5===0 ? 6 : 3;
      context.moveTo(horizontal ? position : width-length,horizontal ? width-length : position);
      context.lineTo(horizontal ? position : width,horizontal ? width : position);
      if (tick%5!==0) continue;
      const label = String(Math.round(tick*minor*100)/100);
      context.save();
      if (!horizontal) {
        context.translate(10,position);
        context.rotate(-Math.PI/2);
      }
      context.fillText(label,horizontal ? position+1 : 1,horizontal ? 10 : 0);
      context.restore();
    }
  }
  context.stroke();
  context.restore();
}

export function Viewport({rig, phase, ghosts, brush, remoteBones, selected, selectedParts, selectedEdge, selectedNode, setNode,
  select, selectRegion, tool, primitive, facets, isolation, smoothing, selectionMode, snapping, rulers, reference, zoom, showBones,
  pen, addKnot, closePolygon, addDrawnPath, addBone, edit}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [snapOverride,setSnapOverride] = useState(false);
  const authoredPoses = useMemo(() => evaluateRig(rig), [rig]);
  const editingIds = useMemo(()=>{
    const editable = editablePartIds(rig);
    return new Set(orderedVisibleParts(rig,isolation).filter(part=>editable.has(part.id)).map(part=>part.id));
  },[rig,isolation]);
  const viewportFrame = viewportFrameFor(rig);
  const guides = (rig.version===2 && rig.guides) || noGuides;
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

  function snap(value:number,axis:Axis) {
    const {width,height} = artboardFor(rig);
    const edge = axis==="x" ? width : height;
    const values = [0,edge,Math.round(value/10)*10,...guides.filter(guide=>guide.axis===axis).map(guide=>guide.position)];
    let best = value;
    let limit = 8 / scale;
    for (const candidate of values) {
      const distance = Math.abs(candidate-value);
      if (distance < limit) {
        best = candidate;
        limit = distance;
      }
    }
    return best;
  }

  function drawingPoint(point:Point,override:boolean) {
    return snapping && !override ? {x:snap(point.x,"x"),y:snap(point.y,"y")} : point;
  }

  function gestureCommand(current: Gesture, point: Point, override:boolean): RigCommand | undefined {
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
        let delta = {x:point.x-current.start.x,y:point.y-current.start.y};
        if (snapping && !override) {
          const {min} = worldPartBounds(current.part,authoredPoses);
          delta = {x:snap(min.x+delta.x,"x")-min.x,y:snap(min.y+delta.y,"y")-min.y};
        }
        return {type:"parts.translate",ids:current.ids,delta};
      }
      case "knot": {
        const knot = current.part.knots[current.index];
        const original = partWorldSpace(knot[current.handle] ?? knot.point,current.part,authoredPoses);
        const target = drawingPoint({x:original.x+point.x-current.start.x,y:original.y+point.y-current.start.y},override);
        const local = partSpace(target,current.part,authoredPoses);
        const knots = current.part.knots.map((knot,index)=>index===current.index ? movePathKnot(knot,current.handle,local) : knot);
        return { type: "part.update", id: current.part.id, changes: { knots } };
      }
      case "facetVertex": {
        const mapper = facetPointMappers(current.part,authoredPoses);
        const vertex = current.part.facets!.vertices.find(item=>item.id===current.vertexId)!;
        const anchor = mapper.world(vertex.point);
        const target = drawingPoint({x:anchor.x+point.x-current.start.x,y:anchor.y+point.y-current.start.y},override);
        return {type:"facet.move",id:current.part.id,vertexId:current.vertexId,point:mapper.local(target)};
      }
    }
  }

  const draft = gesture && cursor ? gestureCommand(gesture,cursor,snapOverride) : undefined;
  const preview: KinetixRigState = draft?.type === "bone.update" ? {
    ...rig, bones: rig.bones.map(bone => bone.id === draft.id ? { ...bone, ...draft.changes } : bone),
  } : draft?.type === "ik.target" ? {
    ...rig, constraints: rig.constraints.map(ik => ik.id === draft.id ? { ...ik, target: draft.target } : ik),
  } : draft?.type === "part.update" ? {
    ...rig, parts: rig.parts.map(part => part.id === draft.id ? { ...part, ...draft.changes } : part),
  } : draft?.type === "parts.translate" ? {
    ...rig, parts:rig.parts.map(part=>draft.ids.includes(part.id) ?
      {...part,offset:translatedPartOffset(part,draft.delta,authoredPoses)} : part),
  } : draft?.type === "facet.move" ? {
    ...rig,parts:rig.parts.map(part=>part.id===draft.id && part.facets ? {
      ...part,facets:{...part.facets,vertices:part.facets.vertices.map(vertex=>vertex.id===draft.vertexId ?
        {...vertex,point:draft.point} : vertex)},
    } : part),
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
        for (const ghost of ghosts) drawRigArtwork(context, ghost.rig, evaluateRig(ghost.rig), ghost.phase, reference,isolation);
        context.restore();
      }
      drawRigArtwork(context, preview, poses, phase, reference,isolation);
      context.restore();
      const pixel = 1 / scale;
      context.lineWidth = 1.5 * pixel;
      if (guides.length) {
        context.save();
        context.strokeStyle = "#216885aa";
        context.setLineDash([4*pixel,4*pixel]);
        for (const guide of guides) {
          const vertical = guide.axis==="x";
          context.beginPath();
          context.moveTo(vertical ? guide.position : viewportFrame.x,vertical ? viewportFrame.y : guide.position);
          context.lineTo(vertical ? guide.position : viewportFrame.x+viewportFrame.width,
            vertical ? viewportFrame.y+viewportFrame.height : guide.position);
          context.stroke();
        }
        context.restore();
      }

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
      if (selectedParts.length>1) {
        context.strokeStyle = "#216885";
        for (const item of preview.parts.filter(item=>selectedParts.includes(item.id) && editingIds.has(item.id))) {
          const {min,max} = worldPartBounds(item,poses);
          context.strokeRect(min.x,min.y,max.x-min.x,max.y-min.y);
        }
      }
      const part = selected?.kind === "part" && selectedParts.length<=1 && editingIds.has(selected.id) ?
        preview.parts.find(item => item.id === selected.id) : undefined;
      if (part?.facets && !brush && (facets || !part.mesh)) {
        const graph = facets?.triangulation ?? part.facets;
        const map = facetPointMappers(part,poses).world;
        const points = new Map(graph.vertices.map(vertex=>[vertex.id,map(vertex.point)]));
        for (const face of graph.faces) {
          context.strokeStyle = facets?.faceId===face.id ? "#fff4d6" : "#392c32b0";
          tracePolygons(context,[face.vertices.map(id=>points.get(id)!)]);
          context.stroke();
        }
        if (facets) {
          const a = points.get(facets.a);
          const b = points.get(facets.b);
          if (a && b && facets.mode==="edge") {
            context.strokeStyle = "#216885";
            context.beginPath();
            context.moveTo(a.x,a.y);
            context.lineTo(b.x,b.y);
            context.stroke();
          }
          if (facets.mode==="vertex" || facets.mode==="draw") for (const [id,point] of points) {
            context.fillStyle = id===facets.a || id===facets.b ? "#f78355" : "#fffcef";
            context.strokeStyle = "#653622";
            circle(context,point,4*pixel);
          }
          if (facets.mode==="draw" && facets.draft.length) {
            const draft = facets.draft.map(item=>map(item.point));
            context.strokeStyle = "#5a2f1f";
            context.fillStyle = "#f78355";
            context.beginPath();
            context.moveTo(draft[0].x,draft[0].y);
            for (const point of draft.slice(1)) context.lineTo(point.x,point.y);
            if (cursor) context.lineTo(cursor.x,cursor.y);
            context.stroke();
            for (const point of draft) circle(context,point,4*pixel);
          }
        }
      } else if (part?.mesh) {
        const points = deformMesh(part, poses);
        traceMesh(context, points, part.mesh.triangles);
        context.strokeStyle = brush ? "#28566cb5" : "#534c43a6";
        context.stroke();
        if (brush) for (const [index, point] of points.entries()) {
          const weight = part.mesh.vertices[index].weights.find(influence => influence.boneId === brush.boneId)?.weight ?? 0;
          context.fillStyle = `hsl(${220 - 205 * weight} 78% 55%)`;
          circle(context, point, 3 * pixel);
        }
      } else if (part) {
        const toWorld = (point:Point) => partWorldSpace(point,part,poses);
        context.strokeStyle = "#a93716";
        context.fillStyle = "#fffcef";
        inPartSpace(context, part, poses, () => tracePart(context, part));
        context.stroke();
        const edge = part.knots[selectedEdge];
        const end = part.knots[(selectedEdge + 1) % part.knots.length];
        if (edge && (part.closed || selectedEdge < part.knots.length-1)) {
          context.save();
          context.strokeStyle = "#216885";
          context.lineWidth = 3 * pixel;
          context.beginPath();
          const startPoint = toWorld(edge.point);
          const endPoint = toWorld(end.point);
          context.moveTo(startPoint.x,startPoint.y);
          if (edge.outgoing || end.incoming) {
            const outgoing = toWorld(edge.outgoing ?? edge.point);
            const incoming = toWorld(end.incoming ?? end.point);
            context.bezierCurveTo(outgoing.x,outgoing.y,incoming.x,incoming.y,endPoint.x,endPoint.y);
          } else context.lineTo(endPoint.x,endPoint.y);
          context.stroke();
          context.restore();
        }
        for (const [index,knot] of part.knots.entries()) {
          context.fillStyle = index === selectedNode ? "#f78355" : "#fffcef";
          const point = toWorld(knot.point);
          for (const handle of [knot.incoming, knot.outgoing]) {
            if (!handle) continue;
            const handlePoint = toWorld(handle);
            context.beginPath();
            context.moveTo(point.x,point.y);
            context.lineTo(handlePoint.x,handlePoint.y);
            context.stroke();
            circle(context, handlePoint, 3 * pixel);
          }
          circle(context, point, 4 * pixel);
        }
        if (part.pivot) {
          context.fillStyle = "#216885";
          context.strokeStyle = "#fffcef";
          circle(context,toWorld(part.pivot),4 * pixel);
        }
      }

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
      const isPrimitive = gesture?.type === "primitive";
      const isPencil = gesture?.type === "pencil";
      const knots = isPrimitive && cursor ? primitiveKnots(primitive,gesture.start,cursor,gesture.square) :
        isPencil ? gesture.points.map(point=>({point})) :
        gesture?.type === "pen" && cursor ? [...pen, penKnot(gesture.start, cursor, pixel)] : pen;
      if (knots.length) {
        tracePart(context, { id: "", name: "", parentId: null, offset: { x: 0, y: 0 }, knots, fill: "#f78355", closed: isPrimitive });
        context.stroke();
        if (!isPrimitive && !isPencil) for (const knot of knots) circle(context, knot.point, 4 * pixel);
      }
      if (gesture?.type==="region" && cursor) {
        context.fillStyle = "#21688524";
        context.strokeStyle = "#216885";
        context.beginPath();
        if (selectionMode==="marquee") {
          const from = gesture.points[0];
          context.rect(from.x,from.y,cursor.x-from.x,cursor.y-from.y);
        } else {
          const [first,...rest] = [...gesture.points,cursor];
          context.moveTo(first.x,first.y);
          for (const item of rest) context.lineTo(item.x,item.y);
          context.closePath();
        }
        context.fill();
        context.stroke();
      }
      if (rulers) drawRulers(context,camera,scale,size,dpr);
    });
    return () => cancelAnimationFrame(frame);
  }, [scale, size, camera.x, camera.y, preview, rig, authoredPoses, phase, reference, selected, selectedParts, selectedEdge, selectedNode,
    showBones, gesture, cursor, pen, ghosts, brush, remoteBones, primitive, facets, isolation, editingIds, selectionMode, rulers, guides,
    viewportFrame.x,viewportFrame.y,viewportFrame.width,viewportFrame.height]);

  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (!scale || event.button !== 0 || !event.isPrimary) return;
    const point = worldPoint(event);
    setSnapOverride(event.altKey);
    const tolerance = (event.pointerType === "touch" ? 15 : 10) / scale;
    let next: Gesture | undefined;
    if (brush) {
      const part = rig.parts.find(item => item.id === brush.partId);
      if (!part?.mesh || !editingIds.has(part.id)) return;
      const mesh = paintMesh(part, authoredPoses, brush.boneId, point, brush.radius, brush.strength);
      next = { type: "paint", part: { ...part, mesh }, last: point, brush };
      setCursor(point);
    } else if (tool==="facet") {
      const part = facets && rig.parts.find(item=>item.id===facets.partId);
      if (!facets || !part || !part.facets || !editingIds.has(part.id)) return;
      const mapper = facetPointMappers(part,authoredPoses);
      const graph = part.facets;
      const world = new Map(graph.vertices.map(vertex=>[vertex.id,mapper.world(vertex.point)]));
      if (facets.mode==="edge") {
        const edges = graph.faces.flatMap(face=>face.vertices.map((a,index)=>{
          const b = face.vertices[(index+1)%face.vertices.length];
          return {a,b,distance:segmentDistance(point,world.get(a)!,world.get(b)!)};
        })).sort((a,b)=>a.distance-b.distance);
        if (edges[0]?.distance<tolerance) facets.pickEdge(edges[0].a,edges[0].b);
        return;
      }
      if (facets.mode==="face" || facets.mode==="sample") {
        const face = facetArtworkFaces(part,authoredPoses).reverse()
          .find(item=>item.polygons.some(polygon=>pointInPolygon(point,polygon)));
        if (face && facets.mode==="sample") facets.sample(face.fill);
        else if (face) facets.pickFace(face.id);
        return;
      }
      const available = facets.mode==="draw" && event.altKey ? facets.draft : [...graph.vertices,...facets.draft];
      const candidates = available.map(vertex=>({
        ...vertex,distance:distance(point,world.get(vertex.id) ?? mapper.world(vertex.point)),
      })).sort((a,b)=>a.distance-b.distance);
      const match = candidates[0]?.distance<tolerance ? candidates[0] : undefined;
      if (facets.mode==="draw") {
        facets.addVertex(match ? {id:match.id,point:match.point} : {
          id:crypto.randomUUID(),point:mapper.local(drawingPoint(point,event.altKey)),
        });
        return;
      }
      if (!match) return;
      facets.pickVertex(match.id);
      next = {type:"facetVertex",part,vertexId:match.id,start:point};
    } else if (tool === "bone" || tool === "pen" || tool === "polygon") {
      next = { type: tool, start: tool==="bone" ? point : drawingPoint(point,event.altKey) };
    } else if (tool === "primitive") {
      next = { type: tool, start: drawingPoint(point,event.altKey), square: event.shiftKey };
    } else if (tool === "pencil") {
      next = { type: tool, points:[point] };
    } else if (tool === "region") {
      next = { type: tool,points:[point] };
    } else {
      const part = selected?.kind === "part" && editingIds.has(selected.id) ? rig.parts.find(item => item.id === selected.id) : undefined;
      if (part && !part.mesh && !part.facets && selectedParts.length<=1) {
        for (const [index, knot] of part.knots.entries()) {
          const handle = (["point", "incoming", "outgoing"] as const).find(key => {
            const candidate = knot[key];
            return candidate && distance(point,partWorldSpace(candidate,part,authoredPoses)) < tolerance;
          });
          if (handle) {
            setNode(index);
            next = { type: "knot", part, index, handle, start:point };
            break;
          }
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
        const masks=partMasks(rig);
        const partsById=new Map(rig.parts.map(part=>[part.id,part]));
        const maskCache=new Map();
        const hit = orderedVisibleParts(rig,isolation).toReversed().find(item => {
          if (!editingIds.has(item.id)) return false;
          const stack=masks.get(item.id);
          if (stack) {
            tracePolygons(context,regionPolygons(maskRegions(partsById,stack,authoredPoses,maskCache)));
            if (!context.isPointInPath(point.x,point.y,"evenodd")) return false;
          }
          if (item.facets) return facetArtworkFaces(item,authoredPoses).some(face=>face.polygons.some(polygon=>pointInPolygon(point,polygon)));
          if (item.mesh) {
            traceMesh(context, deformMesh(item, authoredPoses), item.mesh.triangles);
            return context.isPointInPath(point.x, point.y);
          }
          inPartSpace(context,item,authoredPoses,() => tracePart(context,item));
          return item.closed ? context.isPointInPath(point.x,point.y,item.contours?"evenodd":"nonzero") :
            context.isPointInStroke(point.x,point.y);
        });
        context.restore();
        const preserveGroup = hit && selectedParts.length>1 && selectedParts.includes(hit.id);
        if (!preserveGroup) select(hit ? { kind: "part", id: hit.id } : null);
        if (hit) next = { type: "move",part:hit,ids:preserveGroup ? selectedParts.filter(id=>editingIds.has(id)) : [hit.id],start:point };
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
      addKnot(penKnot(gesture.start,drawingPoint(point,event.altKey),1/scale));
    } else if (gesture.type === "polygon") {
      const first = pen[0]?.point;
      const last = pen.at(-1)?.point;
      if (first && pen.length >= 3 && distance(gesture.start, first) * scale <= 9) closePolygon();
      else if (!last || distance(gesture.start, last) * scale > 1) addKnot({ point: gesture.start });
    } else if (gesture.type === "primitive") {
      const end = drawingPoint(point,event.altKey);
      if (Math.min(Math.abs(end.x-gesture.start.x),Math.abs(end.y-gesture.start.y))*scale > 3) {
        addDrawnPath(true,primitiveKnots(primitive,gesture.start,end,event.shiftKey));
      }
    } else if (gesture.type === "pencil") {
      const points = distance(gesture.points.at(-1)!,point)*scale > 1 ? [...gesture.points,point] : gesture.points;
      if (points.length > 1) addDrawnPath(false,pencilKnots(points,smoothing/scale));
    } else if (gesture.type === "region") {
      const region = [...gesture.points,point];
      const {min,max} = pointBounds(region);
      const ids = rig.parts.filter(part=>{
        if (!editingIds.has(part.id)) return false;
        const bounds = worldPartBounds(part,authoredPoses);
        if (selectionMode==="marquee") return bounds.min.x>=min.x && bounds.max.x<=max.x &&
          bounds.min.y>=min.y && bounds.max.y<=max.y;
        const corners = [bounds.min,bounds.max,{x:bounds.min.x,y:bounds.max.y},{x:bounds.max.x,y:bounds.min.y}];
        return region.length>=3 && corners.every(corner=>pointInPolygon(corner,region));
      }).map(part=>part.id);
      selectRegion(ids);
    } else if (cursor || gesture.type === "paint") {
      if ((gesture.type==="move" || gesture.type==="knot" || gesture.type==="facetVertex") && distance(point,gesture.start)*scale < 1) {
        clear();
        return;
      }
      const command = gestureCommand(gesture,point,event.altKey);
      if (command) edit(gesture.type === "rotate" ? "Rotate bone" : gesture.type === "target" ? "Move IK target" :
        gesture.type === "paint" ? "Paint weights" : gesture.type==="facetVertex" ? "Move facet vertex" : "Edit path", command);
    }
    clear();
  }

  function clear() { setGesture(null); setCursor(null); }

  function nudge(event:KeyboardEvent<HTMLCanvasElement>) {
    const step = nudges[event.key];
    if (!step || tool !== "select" || brush || gesture || !(event.metaKey || event.ctrlKey) || event.altKey ||
        selected?.kind !== "part") return;
    const ids = selectedParts.filter(id=>editingIds.has(id));
    if (!ids.length) return;
    event.preventDefault();
    const amount = event.shiftKey ? 10 : 1;
    edit("Nudge path",{type:"parts.translate",ids,delta:{x:step.x*amount,y:step.y*amount}});
  }

  return <canvas ref={canvas} className="studio-canvas" role="img" aria-label="Rig canvas" tabIndex={0} onKeyDown={nudge}
    data-tool={brush ? "paint" : tool} onPointerDown={down} onPointerMove={event => {
      if (!event.isPrimary || !scale || (!gesture && !brush)) return;
      const point = worldPoint(event);
      setSnapOverride(event.altKey);
      if (gesture?.type === "region" && selectionMode==="lasso") setGesture(current => {
        if (current?.type!=="region" || distance(current.points.at(-1)!,point)*scale<3) return current;
        const points = current.points.length<512 ? current.points : current.points.filter((_,index)=>index%2===0);
        return {...current,points:[...points,point]};
      });
      if (gesture?.type === "primitive" && gesture.square !== event.shiftKey) setGesture({ ...gesture, square: event.shiftKey });
      if (gesture?.type === "pencil") setGesture(current => {
        if (current?.type !== "pencil" || distance(current.points.at(-1)!,point)*scale < 1.5) return current;
        const points = current.points.length < 1200 ? current.points : current.points.filter((_,index)=>index%2===0);
        return { ...current, points:[...points,point] };
      });
      if (gesture?.type === "paint" && distance(point, gesture.last) > gesture.brush.radius * 0.2) {
        const { part, brush: stroke } = gesture;
        const mesh = paintMesh(part, authoredPoses, stroke.boneId, point, stroke.radius, stroke.strength);
        setGesture({ ...gesture, last: point, part: { ...part, mesh } });
      }
      setCursor(gesture && ["primitive","pen"].includes(gesture.type) ? drawingPoint(point,event.altKey) : point);
    }} onPointerLeave={() => { if (!gesture) setCursor(null); }} onPointerUp={end} onPointerCancel={clear} onLostPointerCapture={clear}/>;
}

function penKnot(start: Point, end: Point, pixel: number): VectorKnot {
  if (distance(start, end) < 4 * pixel) return { point: start };
  const reflected = rotatePoint({ x: end.x - start.x, y: end.y - start.y }, Math.PI);
  return { point: start, outgoing: end, incoming: { x: start.x + reflected.x, y: start.y + reflected.y },mode:"smooth" };
}
