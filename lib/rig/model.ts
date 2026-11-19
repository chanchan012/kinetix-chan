import { z } from "zod";
import { studyFor } from "../studies";

const coordinate = z.number().min(-1_000_000).max(1_000_000);
export const pointSchema = z.strictObject({ x: coordinate, y: coordinate });
const identifier = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
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
});

export const knotSchema = z.strictObject({
  point: pointSchema,
  incoming: pointSchema.optional(),
  outgoing: pointSchema.optional(),
});
export const partSchema = z.strictObject({
  id: identifier,
  name: z.string().trim().min(1).max(120),
  parentId: identifier.nullable(),
  offset: pointSchema,
  knots: z.array(knotSchema).min(2).max(256),
  fill: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  closed: z.boolean(),
});

export type Point = z.infer<typeof pointSchema>;
export type Bone = z.infer<typeof boneSchema>;
export type IKConstraint = z.infer<typeof constraintSchema>;
export type VectorPart = z.infer<typeof partSchema>;
export type VectorKnot = z.infer<typeof knotSchema>;

const documentSchema = z.strictObject({
  version: z.literal(1),
  study: z.enum(["fox", "heron", "fish"]),
  bones: z.array(boneSchema).max(512),
  constraints: z.array(constraintSchema).max(128),
  parts: z.array(partSchema).max(128).default([]),
});
export type KinetixRigState = z.infer<typeof documentSchema>;

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
  for (const [index, part] of rig.parts.entries()) {
    if (partIds.has(part.id) || (part.parentId !== null && !bones.has(part.parentId))) {
      context.addIssue({ code: "custom", path: ["parts", index], message: "Parts require unique IDs and an existing parent." });
    }
    partIds.add(part.id);
  }
});

const starter = {
  fox: { x: 201, y: 149, length: 128, name: "Foreleg", joint: { x: 125, y: -5 }, upper: 42, lower: 39 },
  heron: { x: 181, y: 153, length: 148, name: "Wing", joint: { x: 72, y: -13 }, upper: 68, lower: 78 },
  fish: { x: 181, y: 145, length: 184, name: "Fin", joint: { x: 140, y: 4 }, upper: 31, lower: 28 },
};
const limbAngles = { fox: 1.3, heron: -2.6, fish: 2.3 };

export function createRigState(study: KinetixRigState["study"]): KinetixRigState {
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
