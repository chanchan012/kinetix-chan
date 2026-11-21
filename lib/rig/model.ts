import { z } from "zod";
import { studyFor } from "../studies";
import { facetEdgeKey, signedPolygonArea, validFacetPolygon } from "./facet-geometry";
import { layerTreeSchema } from "./layer-tree";
import { appearanceSchema,swatchSchema } from "./appearance";
import { drawingsSchema } from "./drawings";
import { spriteSourcesSchema } from "./sprite-sources";

const coordinate = z.number().min(-1_000_000).max(1_000_000);
export const pointSchema = z.strictObject({ x: coordinate, y: coordinate });
const identifier = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
const meshSchema = z.strictObject({
  origin: pointSchema,
  angle: coordinate,
  offset: pointSchema,
  bindings: z.array(z.strictObject({ id: identifier, origin: pointSchema, angle: coordinate })).min(1).max(512),
  vertices: z.array(z.strictObject({
    point: pointSchema,
    weights: z.array(z.strictObject({ boneId: identifier, weight: z.number().gt(0).max(1) })).min(1).max(4),
    splitFrom:z.tuple([z.int().min(0),z.int().min(0),z.int().min(0)]).optional(),
  })).min(3).max(4096),
  triangles: z.array(z.tuple([z.int().min(0), z.int().min(0), z.int().min(0)])).min(1).max(8192),
}).superRefine((mesh, context) => {
  const bindingIds = new Set(mesh.bindings.map(binding => binding.id));
  if (bindingIds.size !== mesh.bindings.length) context.addIssue({
    code: "custom", path: ["bindings"], message: "Mesh bindings require unique bones.",
  });
  for (const [index, vertex] of mesh.vertices.entries()) {
    const ids = new Set(vertex.weights.map(influence => influence.boneId));
    const sum = vertex.weights.reduce((total, influence) => total + influence.weight, 0);
    if (ids.size !== vertex.weights.length || [...ids].some(id => !bindingIds.has(id)) || Math.abs(sum - 1) > 1e-6) {
      context.addIssue({ code: "custom", path: ["vertices", index], message: "Vertex weights must use unique bound bones and sum to one." });
    }
    if (vertex.splitFrom && (vertex.splitFrom.some(source=>source>=index) || new Set(vertex.splitFrom).size!==3)) {
      context.addIssue({code:"custom",path:["vertices",index,"splitFrom"],message:"A split vertex needs three earlier source vertices."});
    }
  }
  for (const [index, triangle] of mesh.triangles.entries()) {
    if (new Set(triangle).size !== 3 || triangle.some(vertex => vertex >= mesh.vertices.length)) {
      context.addIssue({ code: "custom", path: ["triangles", index], message: "A triangle needs three valid vertices." });
    }
  }
});
export const boneSchema = z.strictObject({
  id: identifier,
  name: z.string().trim().min(1).max(120),
  parentId: identifier.nullable(),
  offset: pointSchema,
  length: z.number().min(0.01).max(10_000),
  rotation: coordinate,
});

export const constraintSchema = z.strictObject({
  id: identifier,
  upperId: identifier,
  lowerId: identifier,
  target: pointSchema,
  bend: z.union([z.literal(1), z.literal(-1)]),
  enabled: z.boolean().optional(),
});

export const knotSchema = z.strictObject({
  point: pointSchema,
  incoming: pointSchema.optional(),
  outgoing: pointSchema.optional(),
  mode: z.enum(["corner","smooth"]).optional(),
});
const scaleComponent = z.number().min(-100).max(100).refine(value => Math.abs(value) >= 0.01);
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const facetGraphSchema = z.strictObject({
  vertices:z.array(z.strictObject({id:identifier,point:pointSchema})).min(3).max(512),
  faces:z.array(z.strictObject({id:identifier,vertices:z.array(identifier).min(3).max(256),fill:color})).min(1).max(512),
}).superRefine((graph,context) => {
  const vertices = new Map(graph.vertices.map(vertex=>[vertex.id,vertex.point]));
  const ids = new Set<string>();
  const edges = new Map<string,number[]>();
  if (vertices.size!==graph.vertices.length) context.addIssue({
    code:"custom",path:["vertices"],message:"Facet vertex IDs must be unique.",
  });
  for (const [index,face] of graph.faces.entries()) {
    const points = face.vertices.map(id=>vertices.get(id));
    if (ids.has(face.id) || new Set(face.vertices).size!==face.vertices.length ||
        points.some(point=>!point) || !validFacetPolygon(points as Point[])) {
      context.addIssue({code:"custom",path:["faces",index],message:"Faces need unique IDs and a simple perimeter of existing vertices."});
      continue;
    }
    ids.add(face.id);
    const orientation = Math.sign(signedPolygonArea(points as Point[]));
    face.vertices.forEach((vertex,i)=>{
      const end = face.vertices[(i+1)%face.vertices.length];
      const key = facetEdgeKey(vertex,end);
      const directions = edges.get(key) ?? [];
      directions.push((vertex<end ? 1 : -1)*orientation);
      edges.set(key,directions);
    });
  }
  if ([...edges.values()].some(directions=>directions.length>2 ||
      (directions.length===2 && directions[0]===directions[1]))) context.addIssue({
    code:"custom",path:["faces"],message:"A shared edge must join facets on opposite sides.",
  });
  if (graph.faces.reduce((sum,face)=>sum+face.vertices.length,0)>8192) context.addIssue({
    code:"custom",path:["faces"],message:"Facet graphs support up to 8,192 face vertices.",
  });
});
export type FacetGraph = z.infer<typeof facetGraphSchema>;
export const partSchema = z.strictObject({
  id: identifier,
  name: z.string().trim().min(1).max(120),
  parentId: identifier.nullable(),
  offset: pointSchema,
  rotation: coordinate.optional(),
  scale: z.strictObject({ x: scaleComponent, y: scaleComponent }).optional(),
  pivot: pointSchema.optional(),
  knots: z.array(knotSchema).min(2).max(256),
  fill: color,
  appearance: appearanceSchema.optional(),
  fillRule: z.enum(["nonzero","evenodd"]).optional(),
  contours:z.array(z.array(knotSchema).min(3).max(2048)).max(128).optional(),
  closed: z.boolean(),
  mesh: meshSchema.optional(),
  facets: facetGraphSchema.optional(),
});

export type Point = z.infer<typeof pointSchema>;
export type Bone = z.infer<typeof boneSchema>;
export type IKConstraint = z.infer<typeof constraintSchema>;
export type VectorPart = z.infer<typeof partSchema>;
export type VectorKnot = z.infer<typeof knotSchema>;
export type SkinMesh = z.infer<typeof meshSchema>;

export const studyIdSchema = z.enum(["fox", "heron", "fish"]);
export const artboardSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  width: z.int().min(16).max(4096),
  height: z.int().min(16).max(4096),
  background: z.string().regex(/^#[a-fA-F0-9]{6}$/).nullable(),
});
export type Artboard = z.infer<typeof artboardSchema>;
export const defaultArtboard: Artboard = { name: "Artboard", width: 512, height: 320, background: null };
export const guideSchema = z.strictObject({axis:z.enum(["x","y"]),position:coordinate});

const documentContents = {
  bones: z.array(boneSchema).max(512),
  constraints: z.array(constraintSchema).max(128),
  parts: z.array(partSchema).max(128).default([]),
  layers: layerTreeSchema.optional(),
  swatches:z.array(swatchSchema).max(128).optional(),
  drawings:drawingsSchema.optional(),
  spriteSources:spriteSourcesSchema.optional(),
};
const documentSchema = z.discriminatedUnion("version", [
  z.strictObject({ version: z.literal(1), study: studyIdSchema, ...documentContents }),
  z.strictObject({ version: z.literal(2), study: z.null(), artboard: artboardSchema,
    guides:z.array(guideSchema).max(64).optional(),...documentContents }),
]);
export type KinetixRigState = z.infer<typeof documentSchema>;
export const artboardFor = (rig: KinetixRigState) => rig.version === 2 ? rig.artboard : defaultArtboard;
export const referenceFrameCount = (rig: KinetixRigState) => rig.study ? studyFor(rig.study).frames : 1;

/** Parent-first traversal with stable sibling order, independent of authoring order. */
export function orderedBones(bones: readonly Bone[]): Bone[] {
  const byId = new Map(bones.map(bone => [bone.id, bone]));
  if (byId.size !== bones.length) throw new Error("Bone IDs must be unique.");
  const ordered: Bone[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(bone: Bone) {
    if (visited.has(bone.id)) return;
    if (visiting.has(bone.id)) throw new Error("A bone cannot be its own ancestor.");
    visiting.add(bone.id);
    if (bone.parentId !== null) {
      const parent = byId.get(bone.parentId);
      if (!parent) throw new Error("Bone parent does not exist.");
      visit(parent);
    }
    visiting.delete(bone.id);
    visited.add(bone.id);
    ordered.push(bone);
  }
  bones.forEach(visit);
  return ordered;
}

export const rigStateSchema = documentSchema.superRefine((rig, context) => {
  try {
    orderedBones(rig.bones);
  } catch (error) {
    context.addIssue({ code: "custom", path: ["bones"], message: (error as Error).message });
  }
  const bones = new Map(rig.bones.map(bone => [bone.id, bone]));
  const ids = new Set<string>();
  const constrained = new Set<string>();
  for (const [index, constraint] of rig.constraints.entries()) {
    const upper = bones.get(constraint.upperId);
    const lower = bones.get(constraint.lowerId);
    if (!upper || !lower || upper === lower || lower.parentId !== upper.id ||
        lower.offset.x !== upper.length || lower.offset.y !== 0) {
      context.addIssue({ code: "custom", path: ["constraints", index], message: "IK requires a child at its parent's tip." });
    }
    if (ids.has(constraint.id) || constrained.has(constraint.upperId) || constrained.has(constraint.lowerId)) {
      context.addIssue({ code: "custom", path: ["constraints", index], message: "IK constraints require distinct IDs and bones." });
    }
    ids.add(constraint.id);
    constrained.add(constraint.upperId);
    constrained.add(constraint.lowerId);
  }
  const partIds = new Set<string>();
  const swatches = new Set(rig.swatches?.map(swatch=>swatch.id));
  if (swatches.size!==(rig.swatches?.length ?? 0)) context.addIssue({
    code:"custom",path:["swatches"],message:"Swatch IDs must be unique.",
  });
  for (const [index, part] of rig.parts.entries()) {
    if (partIds.has(part.id) || (part.parentId !== null && !bones.has(part.parentId))) {
      context.addIssue({ code: "custom", path: ["parts", index], message: "Parts require unique IDs and an existing parent." });
    }
    if (part.mesh && (!part.closed || part.mesh.bindings.some(binding => !bones.has(binding.id)))) {
      context.addIssue({ code: "custom", path: ["parts", index, "mesh"], message: "A mesh requires a closed path and existing bones." });
    }
    if (part.facets && !part.closed) {
      context.addIssue({code:"custom",path:["parts",index,"facets"],message:"Facets require a closed artwork part."});
    }
    if (part.contours && (!part.closed || part.mesh || part.facets ||
        part.contours.reduce((count,ring)=>count+ring.length,part.knots.length)>4096)) {
      context.addIssue({code:"custom",path:["parts",index,"contours"],message:"Compound paths require closed vector artwork and up to 4096 nodes."});
    }
    for (const paint of [part.appearance?.fill,part.appearance?.stroke?.paint]) {
      if (paint?.kind==="swatch" && !swatches.has(paint.id)) context.addIssue({
        code:"custom",path:["parts",index,"appearance"],message:"Choose an existing swatch.",
      });
    }
    partIds.add(part.id);
  }
  const drawingIds = new Set(rig.drawings?.layers.map(layer=>layer.id));
  if (drawingIds.size && !rig.layers) context.addIssue({
    code:"custom",path:["layers"],message:"Drawings require an artwork layer tree.",
  });
  if (rig.layers) {
    const layers = rig.layers.nodes.flatMap(node=>node.kind==="part" ? [node.partId] : []);
    if (layers.length!==partIds.size || layers.some(id=>!partIds.has(id))) context.addIssue({
      code:"custom",path:["layers","nodes"],message:"Each artwork part needs one matching layer.",
    });
    const drawingLayers = rig.layers.nodes.flatMap(node=>node.kind==="drawing" ? [node.drawingId] : []);
    if (drawingLayers.length!==drawingIds.size || new Set(drawingLayers).size!==drawingIds.size ||
        drawingLayers.some(id=>!drawingIds.has(id))) context.addIssue({
      code:"custom",path:["layers","nodes"],message:"Each raster drawing needs one matching layer.",
    });
    const closed = new Set(rig.parts.filter(part=>part.closed).map(part=>part.id));
    for (const node of rig.layers.nodes) {
      if (node.maskPartId && (!closed.has(node.maskPartId) || (node.kind==="part" && node.maskPartId===node.partId))) {
        context.addIssue({code:"custom",path:["layers","nodes"],message:"A clipping mask requires another closed path."});
      }
    }
  }
});

const starter = {
  fox: { x: 201, y: 149, length: 128, name: "Foreleg", joint: { x: 125, y: -5 }, upper: 42, lower: 39 },
  heron: { x: 181, y: 153, length: 148, name: "Wing", joint: { x: 72, y: -13 }, upper: 68, lower: 78 },
  fish: { x: 181, y: 145, length: 184, name: "Fin", joint: { x: 140, y: 4 }, upper: 31, lower: 28 },
};
const limbAngles = { fox: 1.3, heron: -2.6, fish: 2.3 };

export function createBlankRig(artboard: Artboard): KinetixRigState {
  return { version: 2, study: null, artboard: artboardSchema.parse(artboard), bones: [], constraints: [], parts: [] };
}

export function createRigState(study: z.infer<typeof studyIdSchema>): KinetixRigState {
  const { x, y, length, name, joint, upper, lower } = starter[study];
  return {
    version: 1, study, constraints: [], parts: [],
    bones: [
      { id: "root", name: "Body", parentId: null, offset: { x, y }, length, rotation: 0 },
      { id: "upper", name, parentId: "root", offset: { ...joint }, length: upper, rotation: limbAngles[study] },
      { id: "lower", name: name + " tip", parentId: "upper", offset: { x: upper, y: 0 }, length: lower, rotation: 0.32 },
    ],
  };
}

export function readRigState(value: Record<string, unknown>): KinetixRigState {
  if (value.version === undefined) return createRigState(studyFor(value.study).id);
  return rigStateSchema.parse(value);
}
