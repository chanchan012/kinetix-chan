import { current, enablePatches, isDraft, produceWithPatches, type Draft } from "immer";
import { z } from "zod";
import { artboardSchema, boneSchema, constraintSchema, facetGraphSchema, guideSchema, orderedBones, partSchema, pointSchema, rigStateSchema, type KinetixRigState } from "./model";
import { offsetForPartPivot } from "./part-transform";
import { changeNodeMode, joinOpenParts, reverseKnots, simplifyPath, splitPathEdge } from "./path-geometry";
import { layoutOffsets, translatedPartOffset } from "./path-layout";
import { evaluateRig } from "./kinematics";
import { cutFacetFace, mirrorFacets, splitFacetEdge, triangulateFacets, weldFacetVertices } from "./facet-geometry";
import { splitMeshTriangle } from "./skinning";
import { groupLayers,layerId,layerTreeFor,moveLayer,orderedLayers,syncPartLayers,ungroupLayer,type LayerTree } from "./layer-tree";
import { resolvePaint,swatchSchema } from "./appearance";
import { booleanModes,booleanPath,pathRegions } from "./path-boolean";
import { celRunsSchema, drawingFrameSchema, drawingIdSchema, drawingInputSchema, drawingStorageSchema, exposureSchema } from "./drawings";
import { editCelPixels, pixelOperationSchema } from "./cel-tools";

enablePatches();

const boneId = boneSchema.shape.id;
const constraintId = constraintSchema.shape.id;
const geometryId = partSchema.shape.id;
const facetPrefix = z.string().min(1).max(24).regex(/^[A-Za-z0-9_-]+$/);
export const rigCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("bone.create"), bone: boneSchema }),
  z.strictObject({ type: z.literal("bone.update"), id: boneId, changes: boneSchema.omit({ id: true }).partial() }),
  z.strictObject({ type: z.literal("bone.remove"), id: boneId }),
  z.strictObject({ type: z.literal("ik.create"), constraint: constraintSchema }),
  z.strictObject({ type: z.literal("ik.target"), id: constraintId, target: constraintSchema.shape.target }),
  z.strictObject({ type: z.literal("ik.remove"), id: constraintId }),
  z.strictObject({ type: z.literal("part.create"), part: partSchema }),
  z.strictObject({ type: z.literal("part.update"), id: partSchema.shape.id, changes: partSchema.omit({ id: true }).partial() }),
  z.strictObject({ type: z.literal("part.remove"), id: partSchema.shape.id }),
  z.strictObject({ type: z.literal("part.reorder"), id: partSchema.shape.id, direction: z.enum(["forward", "backward"]) }),
  z.strictObject({ type: z.literal("part.pivot"), id: partSchema.shape.id, pivot: partSchema.shape.offset }),
  z.strictObject({ type: z.literal("part.splitEdge"), id: partSchema.shape.id, edge: z.int().min(0).max(255) }),
  z.strictObject({ type: z.literal("part.reverse"), id: partSchema.shape.id }),
  z.strictObject({ type: z.literal("part.nodeMode"), id: partSchema.shape.id, index: z.int().min(0).max(255), mode: z.enum(["corner","smooth"]) }),
  z.strictObject({ type: z.literal("part.cut"), id: partSchema.shape.id, index: z.int().min(0).max(255), newId: partSchema.shape.id.optional() }),
  z.strictObject({ type: z.literal("part.join"), id: partSchema.shape.id, sourceId: partSchema.shape.id }),
  z.strictObject({ type: z.literal("part.simplify"), id: partSchema.shape.id, tolerance: z.number().min(0.01).max(100) }),
  z.strictObject({ type: z.literal("parts.translate"), ids:z.array(partSchema.shape.id).min(1).max(128), delta:partSchema.shape.offset }),
  z.strictObject({ type: z.literal("parts.layout"), ids:z.array(partSchema.shape.id).min(2).max(128),
    axis:z.enum(["x","y"]),mode:z.enum(["min","center","max","distribute"]) }),
  z.strictObject({ type: z.literal("artboard.guides"), guides:z.array(guideSchema).max(64) }),
  z.strictObject({ type: z.literal("facet.initialize"), id:geometryId, faceId:geometryId }),
  z.strictObject({ type: z.literal("facet.add"), id:geometryId, faceId:geometryId, fill:partSchema.shape.fill,
    vertices:z.array(z.strictObject({id:geometryId,point:pointSchema.optional()})).min(3).max(256) }),
  z.strictObject({ type: z.literal("facet.move"), id:geometryId, vertexId:geometryId, point:pointSchema }),
  z.strictObject({ type: z.literal("facet.paint"), id:geometryId, faceId:geometryId, fill:partSchema.shape.fill }),
  z.strictObject({ type: z.literal("facet.splitEdge"), id:geometryId, a:geometryId, b:geometryId, vertexId:geometryId,
    progress:z.number().gt(0).lt(1).optional() }),
  z.strictObject({ type: z.literal("facet.cut"), id:geometryId, faceId:geometryId, a:geometryId, b:geometryId, nextFaceId:geometryId }),
  z.strictObject({ type: z.literal("facet.weld"), id:geometryId, retained:geometryId, removed:geometryId }),
  z.strictObject({ type: z.literal("facet.mirror"), id:geometryId, axis:z.enum(["x","y"]), at:z.number().min(-1_000_000).max(1_000_000), prefix:facetPrefix }),
  z.strictObject({ type: z.literal("facet.triangulate"), id:geometryId, faceId:geometryId.optional(), prefix:facetPrefix }),
  z.strictObject({ type: z.literal("mesh.splitTriangle"), id:geometryId, index:z.int().min(0).max(8191) }),
  z.strictObject({ type:z.literal("layer.group"), id:layerId,
    name:z.string().trim().min(1).max(120),members:z.array(layerId).min(1).max(128) }),
  z.strictObject({ type:z.literal("layer.ungroup"),id:layerId }),
  z.strictObject({ type:z.literal("layer.rename"),id:layerId,name:z.string().trim().min(1).max(120) }),
  z.strictObject({ type:z.literal("layer.flags"),id:layerId,hidden:z.boolean().optional(),locked:z.boolean().optional() }),
  z.strictObject({ type:z.literal("layer.mask"),id:layerId,partId:geometryId.nullable() }),
  z.strictObject({ type:z.literal("swatch.set"),swatch:swatchSchema }),
  z.strictObject({ type:z.literal("swatch.remove"),id:geometryId }),
  z.strictObject({ type:z.literal("parts.boolean"),ids:z.array(geometryId).min(2).max(128),mode:z.enum(booleanModes) }),
  z.strictObject({ type:z.literal("layer.move"),id:layerId,parentId:layerId.nullable(),index:z.int().min(0).max(256) }),
  z.strictObject({ type:z.literal("layer.duplicate"),id:layerId,prefix:facetPrefix }),
  z.strictObject({type:z.literal("drawing.create"),drawing:drawingInputSchema}),
  z.strictObject({type:z.literal("drawing.remove"),id:drawingIdSchema}),
  z.strictObject({type:z.literal("drawing.palette"),id:drawingIdSchema,colors:drawingStorageSchema.options[1].shape.colors}),
  z.strictObject({type:z.literal("drawing.rest"),id:drawingIdSchema,celId:drawingIdSchema.nullable()}),
  z.strictObject({type:z.literal("cel.create"),drawingId:drawingIdSchema,id:drawingIdSchema,sourceId:drawingIdSchema.optional()}),
  z.strictObject({type:z.literal("cel.replace"),drawingId:drawingIdSchema,id:drawingIdSchema,runs:celRunsSchema}),
  z.strictObject({type:z.literal("cel.edit"),drawingId:drawingIdSchema,id:drawingIdSchema,operation:pixelOperationSchema}),
  z.strictObject({type:z.literal("cel.remove"),drawingId:drawingIdSchema,id:drawingIdSchema}),
  z.strictObject({type:z.literal("exposure.set"),drawingId:drawingIdSchema,clipId:z.uuid(),key:exposureSchema}),
  z.strictObject({type:z.literal("exposure.remove"),drawingId:drawingIdSchema,clipId:z.uuid(),frame:drawingFrameSchema}),
  z.strictObject({ type: z.literal("artboard.update"), artboard: artboardSchema }),
]);
export type RigCommand = z.infer<typeof rigCommandSchema>;

export const rigActorSchema = z.strictObject({
  kind: z.enum(["human", "ai"]),
  id: z.string().trim().min(1).max(128),
});
export type RigActor = z.infer<typeof rigActorSchema>;

function findById<T extends { id: string }>(items: readonly T[], id: string, label: string): T {
  const item = items.find(entry => entry.id === id);
  if (!item) throw new Error(label + " does not exist.");
  return item;
}

function facetPart(rig:Draft<KinetixRigState>,id:string) {
  const part = findById(rig.parts,id,"Facet part");
  if (!part.facets) throw new Error("Choose faceted artwork.");
  return {part,graph:part.facets};
}

function requireUnlocked(rig:Draft<KinetixRigState>,ids:readonly string[]) {
  if (!rig.layers) return;
  const locked = orderedLayers(rig.layers).some(row=>row.locked && row.node.kind==="part" && ids.includes(row.node.partId));
  if (locked) throw new Error("Unlock the artwork layer before editing it.");
}

function sourceLayers(rig:Draft<KinetixRigState>):LayerTree {
  return rig.layers ?? (rig.layers=layerTreeFor(rig));
}

function editDrawing(rig:Draft<KinetixRigState>,id:string) {
  const drawing = findById(rig.drawings?.layers ?? [],id,"Raster drawing");
  const layer = orderedLayers(sourceLayers(rig)).find(({node})=>node.kind==="drawing" && node.drawingId===id);
  if (layer?.locked) throw new Error("Unlock the drawing layer before editing it.");
  return drawing;
}

function cloneValue<T extends object>(value:T):T {
  return structuredClone(isDraft(value) ? current(value as Draft<T>) : value);
}

function applyCommand(rig: Draft<KinetixRigState>, command: RigCommand) {
  if ("id" in command && /^(part|facet|mesh)\./.test(command.type)) requireUnlocked(rig,[command.id]);
  switch (command.type) {
    case "bone.create":
      rig.bones.push(command.bone);
      break;
    case "bone.update":
      Object.assign(findById(rig.bones, command.id, "Bone"), command.changes);
      break;
    case "bone.remove": {
      findById(rig.bones, command.id, "Bone");
      const removed = new Set([command.id]);
      for (const bone of orderedBones(rig.bones)) {
        if (bone.parentId !== null && removed.has(bone.parentId)) removed.add(bone.id);
      }
      rig.bones = rig.bones.filter(bone => !removed.has(bone.id));
      rig.constraints = rig.constraints.filter(ik => !removed.has(ik.upperId) && !removed.has(ik.lowerId));
      rig.parts = rig.parts.filter(part => part.parentId === null || !removed.has(part.parentId));
      for (const part of rig.parts) {
        if (part.mesh?.bindings.some(binding => removed.has(binding.id))) delete part.mesh;
      }
      break;
    }
    case "ik.create":
      rig.constraints.push(command.constraint);
      break;
    case "ik.target":
      findById(rig.constraints, command.id, "Constraint").target = command.target;
      break;
    case "ik.remove":
      findById(rig.constraints, command.id, "Constraint");
      rig.constraints = rig.constraints.filter(ik => ik.id !== command.id);
      break;
    case "part.create":
      rig.parts.push(command.part);
      break;
    case "part.update": {
      const part = findById(rig.parts, command.id, "Vector part");
      if (command.changes.knots || command.changes.closed === false ||
          (command.changes.parentId !== undefined && command.changes.parentId !== part.parentId)) delete part.mesh;
      Object.assign(part, command.changes);
      break;
    }
    case "part.remove":
      findById(rig.parts, command.id, "Vector part");
      rig.parts = rig.parts.filter(part => part.id !== command.id);
      break;
    case "part.reorder": {
      const part = findById(rig.parts, command.id, "Vector part");
      if (rig.layers) {
        const node = rig.layers.nodes.find(item=>item.kind==="part" && item.partId===part.id)!;
        const siblings = rig.layers.nodes.filter(item=>item.parentId===node.parentId);
        const index = siblings.indexOf(node)+(command.direction==="forward" ? 1 : -1);
        if (index<0 || index>=siblings.length) throw new Error("The part is already at this end of the stack.");
        moveLayer(rig.layers,node.id,node.parentId,index);
        break;
      }
      const index = rig.parts.indexOf(part);
      const next = index + (command.direction === "forward" ? 1 : -1);
      if (next < 0 || next >= rig.parts.length) throw new Error("The part is already at this end of the stack.");
      rig.parts.splice(index, 1);
      rig.parts.splice(next, 0, part);
      break;
    }
    case "part.pivot": {
      const part = findById(rig.parts, command.id, "Vector part");
      part.offset = offsetForPartPivot(part,command.pivot);
      part.pivot = command.pivot;
      break;
    }
    case "part.splitEdge": {
      const part = findById(rig.parts, command.id, "Vector part");
      part.knots = splitPathEdge(part,command.edge);
      break;
    }
    case "part.reverse": {
      const part = findById(rig.parts,command.id,"Vector part");
      part.knots = reverseKnots(part.knots);
      break;
    }
    case "part.nodeMode": {
      const part = findById(rig.parts,command.id,"Vector part");
      part.knots = changeNodeMode(part,command.index,command.mode);
      delete part.mesh;
      break;
    }
    case "part.cut": {
      const part = findById(rig.parts,command.id,"Vector part");
      if (part.contours?.length) throw new Error("Choose a path with a single contour to cut.");
      const index = command.index;
      const knot = part.knots[index];
      if (!knot) throw new Error("This path node does not exist.");
      const start = {...knot,incoming:undefined};
      const end = {...knot,outgoing:undefined};
      if (part.closed) {
        part.knots = [start,...part.knots.slice(index+1),...part.knots.slice(0,index),end];
        part.closed = false;
        delete part.mesh;
      } else {
        if (index === 0 || index === part.knots.length-1 || !command.newId) {
          throw new Error("Choose an interior node and an ID for the second path.");
        }
        const tail = {...part,id:command.newId,name:(part.name.slice(0,114)+" split"),
          offset:{...part.offset},scale:part.scale && {...part.scale},pivot:part.pivot && {...part.pivot},
          knots:[{...start,point:{...start.point}},...part.knots.slice(index+1)]};
        part.knots = [...part.knots.slice(0,index),end];
        rig.parts.splice(rig.parts.indexOf(part)+1,0,tail);
      }
      break;
    }
    case "part.join": {
      const target = findById(rig.parts,command.id,"Vector part");
      const source = findById(rig.parts,command.sourceId,"Vector part");
      requireUnlocked(rig,[source.id]);
      target.knots = joinOpenParts(target,source);
      rig.parts = rig.parts.filter(part=>part.id!==source.id);
      break;
    }
    case "part.simplify": {
      const part = findById(rig.parts,command.id,"Vector part");
      const knots = simplifyPath(part,command.tolerance);
      if (knots.length === part.knots.length) break;
      part.knots = knots;
      delete part.mesh;
      break;
    }
    case "parts.translate": {
      requireUnlocked(rig,command.ids);
      const poses = evaluateRig(rig);
      for (const id of new Set(command.ids)) {
        const part = findById(rig.parts,id,"Vector part");
        part.offset = translatedPartOffset(part,command.delta,poses);
      }
      break;
    }
    case "parts.layout": {
      requireUnlocked(rig,command.ids);
      const parts = [...new Set(command.ids)].map(id=>findById(rig.parts,id,"Vector part"));
      if (parts.length < (command.mode==="distribute" ? 3 : 2)) {
        throw new Error("Select at least two paths to align or three to distribute.");
      }
      const poses = evaluateRig(rig);
      const result = layoutOffsets(parts,poses,command.axis,command.mode==="distribute" ? undefined : command.mode);
      for (const {id,offset} of result) findById(parts,id,"Vector part").offset = offset;
      break;
    }
    case "artboard.guides":
      if (rig.version !== 2) throw new Error("Guides require a design artboard.");
      rig.guides = command.guides;
      break;
    case "facet.initialize": {
      const part = findById(rig.parts,command.id,"Vector part");
      if (part.facets || part.contours?.length || !part.closed || part.knots.some(knot=>knot.incoming || knot.outgoing)) {
        throw new Error("Choose a closed polygon without curved segments.");
      }
      const vertices = part.knots.map((knot,index)=>({id:"vertex-"+(index+1),point:{...knot.point}}));
      part.facets = {vertices,faces:[{id:command.faceId,fill:part.fill,vertices:vertices.map(vertex=>vertex.id)}]};
      break;
    }
    case "facet.add": {
      const {graph} = facetPart(rig,command.id);
      for (const vertex of command.vertices) {
        const existing = graph.vertices.some(item=>item.id===vertex.id);
        if (vertex.point && !existing) graph.vertices.push({id:vertex.id,point:vertex.point});
        else if (vertex.point || !existing) throw new Error("Use an existing vertex or supply a point for a new one.");
      }
      graph.faces.push({id:command.faceId,fill:command.fill,vertices:command.vertices.map(vertex=>vertex.id)});
      break;
    }
    case "facet.move": {
      const {graph} = facetPart(rig,command.id);
      findById(graph.vertices,command.vertexId,"Facet vertex").point = command.point;
      break;
    }
    case "facet.paint": {
      const {graph} = facetPart(rig,command.id);
      findById(graph.faces,command.faceId,"Facet face").fill = command.fill;
      break;
    }
    case "facet.splitEdge": {
      const {part,graph} = facetPart(rig,command.id);
      part.facets = splitFacetEdge(graph,command.a,command.b,command.vertexId,command.progress);
      break;
    }
    case "facet.cut": {
      const {part,graph} = facetPart(rig,command.id);
      part.facets = cutFacetFace(graph,command.faceId,command.a,command.b,command.nextFaceId);
      break;
    }
    case "facet.weld": {
      const {part,graph} = facetPart(rig,command.id);
      part.facets = weldFacetVertices(graph,command.retained,command.removed);
      break;
    }
    case "facet.mirror": {
      const {part,graph} = facetPart(rig,command.id);
      part.facets = mirrorFacets(graph,command.axis,command.at,command.prefix);
      break;
    }
    case "facet.triangulate": {
      const {part,graph} = facetPart(rig,command.id);
      if (command.faceId) findById(graph.faces,command.faceId,"Facet face");
      part.facets = facetGraphSchema.parse(triangulateFacets(graph,command.prefix,command.faceId));
      break;
    }
    case "mesh.splitTriangle": {
      const part = findById(rig.parts,command.id,"Vector part");
      if (!part.mesh) throw new Error("Bind a mesh before splitting a triangle.");
      part.mesh = splitMeshTriangle(part.mesh,command.index);
      break;
    }
    case "layer.group":
      groupLayers(sourceLayers(rig),command.id,command.name,command.members);
      break;
    case "layer.ungroup":
      ungroupLayer(sourceLayers(rig),command.id);
      break;
    case "layer.rename": {
      const node = findById(sourceLayers(rig).nodes,command.id,"Layer");
      if (node.kind==="group") node.name = command.name;
      else if (node.kind==="drawing") editDrawing(rig,node.drawingId).name = command.name;
      else findById(rig.parts,node.partId,"Vector part").name = command.name;
      break;
    }
    case "layer.flags": {
      const node = findById(sourceLayers(rig).nodes,command.id,"Layer");
      if (command.hidden!==undefined) node.hidden=command.hidden;
      if (command.locked!==undefined) node.locked=command.locked;
      break;
    }
    case "layer.mask": {
      const node = findById(sourceLayers(rig).nodes,command.id,"Layer");
      if (command.partId) {
        const mask = findById(rig.parts,command.partId,"Mask path");
        if (!pathRegions(mask,evaluateRig(rig)).length) throw new Error("Choose a mask with a filled area.");
        node.maskPartId = command.partId;
      }
      else delete node.maskPartId;
      break;
    }
    case "swatch.set": {
      const swatches = rig.swatches ?? (rig.swatches=[]);
      const index = swatches.findIndex(entry=>entry.id===command.swatch.id);
      if (index<0) swatches.push(command.swatch);
      else swatches[index]=command.swatch;
      break;
    }
    case "swatch.remove": {
      const swatches = rig.swatches ?? [];
      findById(swatches,command.id,"Swatch");
      for (const part of rig.parts) {
        const fill = part.appearance?.fill;
        const stroke = part.appearance?.stroke;
        if (fill?.kind==="swatch" && fill.id===command.id) part.appearance!.fill=cloneValue(resolvePaint(fill,swatches));
        if (stroke?.paint.kind==="swatch" && stroke.paint.id===command.id) stroke.paint=cloneValue(resolvePaint(stroke.paint,swatches));
      }
      rig.swatches = swatches.filter(entry=>entry.id!==command.id);
      break;
    }
    case "parts.boolean": {
      const ids = [...new Set(command.ids)];
      if (ids.length<2) throw new Error("Choose at least two closed paths.");
      requireUnlocked(rig,ids);
      const source = ids.map(id=>findById(rig.parts,id,"Path"));
      const [target] = source;
      Object.assign(target,booleanPath(source,command.mode,evaluateRig(rig)),{mesh:undefined,facets:undefined});
      rig.parts=rig.parts.filter(part=>part.id===target.id || !ids.includes(part.id));
      break;
    }
    case "layer.move":
      moveLayer(sourceLayers(rig),command.id,command.parentId,command.index);
      break;
    case "layer.duplicate": {
      const tree = sourceLayers(rig);
      const node = findById(tree.nodes,command.id,"Layer");
      const {prefix} = command;
      let serial = 0;
      const copiedParts = new Map<string,string>();
      const created = new Set<string>();
      function copy(source:typeof node,parentId:string|null) {
        const id = prefix+"-"+serial++;
        created.add(id);
        if (source.kind==="part") {
          const part = findById(rig.parts,source.partId,"Vector part");
          const duplicate = cloneValue(part);
          copiedParts.set(part.id,id);
          rig.parts.push({...duplicate,id,name:(part.name.slice(0,115)+" copy")});
          tree.nodes.push({...source,id,parentId,partId:id});
        } else if (source.kind==="drawing") {
          const drawing = findById(rig.drawings!.layers,source.drawingId,"Raster drawing");
          rig.drawings!.layers.push({...cloneValue(drawing),id,name:drawing.name.slice(0,115)+" copy"});
          tree.nodes.push({...source,id,parentId,drawingId:id});
        } else {
          const children = tree.nodes.filter(item=>item.parentId===source.id);
          tree.nodes.push({...source,id,parentId,name:(source.name.slice(0,115)+" copy")});
          for (const child of children) copy(child,id);
        }
        return id;
      }
      const siblings = tree.nodes.filter(item=>item.parentId===node.parentId);
      const id = copy(node,node.parentId);
      for (const layer of tree.nodes) {
        if (created.has(layer.id) && layer.maskPartId) layer.maskPartId=copiedParts.get(layer.maskPartId) ?? layer.maskPartId;
      }
      moveLayer(tree,id,node.parentId,siblings.indexOf(node)+1);
      break;
    }
    case "drawing.create": {
      const layers = sourceLayers(rig);
      const catalog = rig.drawings ?? (rig.drawings={version:1,layers:[]});
      const {id} = command.drawing;
      catalog.layers.push({...command.drawing,cels:[],tracks:[],restCelId:null});
      layers.nodes.push({kind:"drawing",id,parentId:null,drawingId:id});
      break;
    }
    case "drawing.remove": {
      editDrawing(rig,command.id);
      rig.drawings!.layers = rig.drawings!.layers.filter(layer=>layer.id!==command.id);
      const tree = sourceLayers(rig);
      tree.nodes = tree.nodes.filter(node=>node.kind!=="drawing" || node.drawingId!==command.id);
      break;
    }
    case "drawing.palette": {
      const drawing = editDrawing(rig,command.id);
      if (drawing.storage.mode!=="indexed") throw new Error("This drawing uses direct RGBA colors.");
      drawing.storage.colors = command.colors;
      break;
    }
    case "drawing.rest": {
      editDrawing(rig,command.id).restCelId = command.celId;
      break;
    }
    case "cel.create": {
      const drawing = editDrawing(rig,command.drawingId);
      const source = command.sourceId && findById(drawing.cels,command.sourceId,"Source cel");
      drawing.cels.push({id:command.id,runs:source ? cloneValue(source.runs) : []});
      break;
    }
    case "cel.replace": {
      const drawing = editDrawing(rig,command.drawingId);
      findById(drawing.cels,command.id,"Cel").runs = command.runs;
      break;
    }
    case "cel.edit": {
      const drawing = editDrawing(rig,command.drawingId);
      const cel = findById(drawing.cels,command.id,"Cel");
      cel.runs = editCelPixels(drawing,cel.runs,command.operation);
      break;
    }
    case "cel.remove": {
      const drawing = editDrawing(rig,command.drawingId);
      findById(drawing.cels,command.id,"Cel");
      if (drawing.restCelId===command.id || drawing.tracks.some(track=>track.keys.some(key=>key.celId===command.id))) {
        throw new Error("Unlink this cel before deleting it.");
      }
      drawing.cels = drawing.cels.filter(cel=>cel.id!==command.id);
      break;
    }
    case "exposure.set": {
      const drawing = editDrawing(rig,command.drawingId);
      const track = drawing.tracks.find(track=>track.clipId===command.clipId);
      if (track) {
        track.keys = track.keys.filter(key=>key.frame!==command.key.frame);
        track.keys.push(command.key);
        track.keys.sort((a,b)=>a.frame-b.frame);
      } else drawing.tracks.push({clipId:command.clipId,keys:[command.key]});
      break;
    }
    case "exposure.remove": {
      const drawing = editDrawing(rig,command.drawingId);
      const track = drawing.tracks.find(track=>track.clipId===command.clipId);
      if (track) {
        track.keys = track.keys.filter(key=>key.frame!==command.frame);
        if (!track.keys.length) drawing.tracks = drawing.tracks.filter(item=>item.clipId!==command.clipId);
      }
      break;
    }
    case "artboard.update":
      if (rig.version !== 2) throw new Error("Artboard settings require a blank design document.");
      rig.artboard = command.artboard;
      break;
  }
}

/** Apply a group atomically. A failed command or final validation leaves the input untouched. */
export function editRig(rig: KinetixRigState, commands: readonly RigCommand[]) {
  const validated = z.array(rigCommandSchema).min(1).max(100).parse(commands);
  const result = produceWithPatches(rig, draft => {
    for (const command of validated) {
      applyCommand(draft, command);
      if (draft.layers) syncPartLayers(draft.layers,draft.parts);
    }
  });
  rigStateSchema.parse(result[0]);
  return result;
}
