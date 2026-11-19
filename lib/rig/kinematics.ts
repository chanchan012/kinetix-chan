import { orderedBones, type Bone, type KinetixRigState, type Point } from "./model";

export type BonePose = { origin: Point; angle: number; tip: Point };

export function rotatePoint(point: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

function poseOf(bone: Bone, parent: BonePose | undefined, rotation: number): BonePose {
  const angle = (parent?.angle ?? 0) + rotation;
  const offset = rotatePoint(bone.offset, parent?.angle ?? 0);
  const origin = { x: (parent?.origin.x ?? 0) + offset.x, y: (parent?.origin.y ?? 0) + offset.y };
  const tip = { x: origin.x + Math.cos(angle) * bone.length, y: origin.y + Math.sin(angle) * bone.length };
  return { origin, angle, tip };
}

function poseBones(bones: readonly Bone[], rotations = new Map<string, number>()) {
  const result = new Map<string, BonePose>();
  for (const bone of bones) {
    const parent = bone.parentId === null ? undefined : result.get(bone.parentId);
    result.set(bone.id, poseOf(bone, parent, rotations.get(bone.id) ?? bone.rotation));
  }
  return result;
}

export function forwardKinematics(bones: readonly Bone[]): Map<string, BonePose> {
  return poseBones(orderedBones(bones));
}

export function solveTwoBoneIK({
  origin, target, upperLength, lowerLength, bend, parentAngle = 0, fallbackAngle = 0,
}: {
  origin: Point; target: Point; upperLength: number; lowerLength: number;
  bend: 1 | -1; parentAngle?: number; fallbackAngle?: number;
}): { upperRotation: number; lowerRotation: number } {
  const x = target.x - origin.x;
  const y = target.y - origin.y;
  const distance = Math.hypot(x, y);
  const reach = Math.max(Math.abs(upperLength - lowerLength), Math.min(upperLength + lowerLength, distance));
  if (reach === 0) return { upperRotation: fallbackAngle - parentAngle, lowerRotation: bend * Math.PI };

  const cosine = (reach * reach - upperLength * upperLength - lowerLength * lowerLength) /
    (2 * upperLength * lowerLength);
  const lowerRotation = bend * Math.acos(Math.max(-1, Math.min(1, cosine)));
  const direction = distance === 0 ? fallbackAngle : Math.atan2(y, x);
  const correction = Math.atan2(lowerLength * Math.sin(lowerRotation),
    upperLength + lowerLength * Math.cos(lowerRotation));
  return { upperRotation: direction - correction - parentAngle, lowerRotation };
}

/** Resolve ancestor constraints before descendants. The authored rotations stay intact. */
export function evaluateRig(rig: KinetixRigState): Map<string, BonePose> {
  const bones = orderedBones(rig.bones);
  const order = new Map(bones.map((bone, index) => [bone.id, index]));
  const constraints = rig.constraints.filter(item => item.enabled !== false)
    .sort((a, b) => order.get(a.upperId)! - order.get(b.upperId)!);
  const rotations = new Map<string, number>();
  let poses = poseBones(bones);
  for (const constraint of constraints) {
    const upper = bones[order.get(constraint.upperId)!];
    const lower = bones[order.get(constraint.lowerId)!];
    const pose = poses.get(upper.id)!;
    const parentAngle = upper.parentId === null ? 0 : poses.get(upper.parentId)!.angle;
    const solution = solveTwoBoneIK({
      origin: pose.origin, target: constraint.target, upperLength: upper.length, lowerLength: lower.length,
      bend: constraint.bend, parentAngle, fallbackAngle: pose.angle,
    });
    rotations.set(upper.id, solution.upperRotation);
    rotations.set(lower.id, solution.lowerRotation);
    poses = poseBones(bones, rotations);
  }
  return poses;
}
