import { enablePatches, produceWithPatches, type Draft } from "immer";
import { z } from "zod";
import { boneSchema, constraintSchema, orderedBones, rigStateSchema, type KinetixRigState } from "./model";

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
