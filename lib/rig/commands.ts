import { enablePatches, produceWithPatches, type Draft } from "immer";
import { z } from "zod";
import { artboardSchema, boneSchema, constraintSchema, orderedBones, partSchema, rigStateSchema, type KinetixRigState } from "./model";

enablePatches();

const boneId = boneSchema.shape.id;
const constraintId = constraintSchema.shape.id;
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
  z.strictObject({ type: z.literal("part.splitEdge"), id: partSchema.shape.id, edge: z.int().min(0).max(255) }),
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

function applyCommand(rig: Draft<KinetixRigState>, command: RigCommand) {
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
      const index = rig.parts.indexOf(part);
      const next = index + (command.direction === "forward" ? 1 : -1);
      if (next < 0 || next >= rig.parts.length) throw new Error("The part is already at this end of the stack.");
      rig.parts.splice(index, 1);
      rig.parts.splice(next, 0, part);
      break;
    }
    case "part.splitEdge": {
      const part = findById(rig.parts, command.id, "Vector part");
      const segments = part.closed ? part.knots.length : part.knots.length - 1;
      if (command.edge >= segments) throw new Error("This edge does not exist.");
      const start = part.knots[command.edge];
      const end = part.knots[(command.edge + 1) % part.knots.length];
      if (start.outgoing || end.incoming) throw new Error("Select a straight polygon edge.");
      part.knots.splice(command.edge + 1, 0, { point: {
        x: (start.point.x + end.point.x) / 2,
        y: (start.point.y + end.point.y) / 2,
      } });
      delete part.mesh;
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
    for (const command of validated) applyCommand(draft, command);
  });
  rigStateSchema.parse(result[0]);
  return result;
}
