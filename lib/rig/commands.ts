import { enablePatches, produceWithPatches, type Draft } from "immer";
import { z } from "zod";
import { artboardSchema, boneSchema, constraintSchema, guideSchema, orderedBones, partSchema, rigStateSchema, type KinetixRigState } from "./model";
import { offsetForPartPivot } from "./part-transform";
import { changeNodeMode, joinOpenParts, reverseKnots, simplifyPath, splitPathEdge } from "./path-geometry";
import { layoutOffsets, translatedPartOffset } from "./path-layout";
import { evaluateRig } from "./kinematics";

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
      const poses = evaluateRig(rig);
      for (const id of new Set(command.ids)) {
        const part = findById(rig.parts,id,"Vector part");
        part.offset = translatedPartOffset(part,command.delta,poses);
      }
      break;
    }
    case "parts.layout": {
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
