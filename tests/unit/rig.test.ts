import { describe, expect, it } from "vitest";
import { evaluateRig, forwardKinematics, solveTwoBoneIK } from "../../lib/rig/kinematics";
import { createRigState, readRigState, rigStateSchema, type KinetixRigState } from "../../lib/rig/model";
import { createRigStore } from "../../lib/rig/store";
import type { RigCommand } from "../../lib/rig/commands";

const fixture = (): KinetixRigState => ({
  version: 1, study: "fox", constraints: [],
  bones: [
    { id: "body", name: "Body", parentId: null, offset: { x: 10, y: 20 }, length: 6, rotation: Math.PI / 2 },
    { id: "upper", name: "Foreleg", parentId: "body", offset: { x: 6, y: 0 }, length: 5, rotation: 0 },
    { id: "lower", name: "Paw", parentId: "upper", offset: { x: 5, y: 0 }, length: 3, rotation: -Math.PI / 2 },
  ],
});
const human = { kind: "human", id: "artist" } as const;
const ai = { kind: "ai", id: "assistant" } as const;
const attach: RigCommand = { type: "ik.create", constraint: {
  id: "reach", upperId: "upper", lowerId: "lower", target: { x: 14, y: 30 }, bend: 1,
} };

describe("rig documents", () => {
  it("instantiates legacy study rigs deterministically and validates each starter", () => {
    for (const study of ["fox", "heron", "fish"] as const) {
      const legacy = readRigState({ study });
      expect(legacy).toEqual(createRigState(study));
      expect(readRigState(legacy)).toEqual(legacy);
    }
    expect(() => readRigState({ version: 2 })).toThrow();
  });

  it("rejects duplicate bones, ancestor cycles and missing parents", () => {
    const rig = fixture();
    const [body, upper, lower] = rig.bones;
    expect(rigStateSchema.safeParse({ ...rig, bones: [body, upper, upper] }).success).toBe(false);
    expect(rigStateSchema.safeParse({ ...rig, bones: [upper, lower] }).success).toBe(false);
    expect(rigStateSchema.safeParse({ ...rig, bones: [{ ...body, parentId: lower.id }, upper, lower] }).success).toBe(false);
  });
});

describe("kinematics", () => {
  it("rotates child offsets and computes world-space tips regardless of input order", () => {
    const rig = fixture();
    const pose = forwardKinematics([...rig.bones].reverse()).get("lower")!;
    expect(pose.origin.x).toBeCloseTo(10);
    expect(pose.origin.y).toBeCloseTo(31);
    expect(pose.angle).toBeCloseTo(0);
    expect(pose.tip.x).toBeCloseTo(13);
    expect(pose.tip.y).toBeCloseTo(31);
  });

  it("hits a reachable target under a rotated parent for either bend direction", () => {
    const rig = fixture();
    for (const bend of [1, -1] as const) {
      rig.constraints = [{ ...attach.constraint, bend }];
      const pose = evaluateRig(rig);
      expect(pose.get("lower")!.tip.x).toBeCloseTo(14);
      expect(pose.get("lower")!.tip.y).toBeCloseTo(30);
      expect(Math.sign(pose.get("lower")!.angle - pose.get("upper")!.angle)).toBe(bend);
      expect(rig.bones[2].rotation).toBe(-Math.PI / 2);
    }
  });

  it.each([
    { upperLength: 5, lowerLength: 3, target: { x: 100, y: 0 }, reach: 8 },
    { upperLength: 3, lowerLength: 5, target: { x: 0, y: 1 }, reach: 2 },
    { upperLength: 5, lowerLength: 5, target: { x: 0, y: 0 }, reach: 0 },
  ])("clamps the endpoint to reachable distance $reach", ({ upperLength, lowerLength, target, reach }) => {
    const { upperRotation, lowerRotation } = solveTwoBoneIK({
      origin: { x: 0, y: 0 }, target, upperLength, lowerLength, bend: 1,
    });
    const x = upperLength * Math.cos(upperRotation) + lowerLength * Math.cos(upperRotation + lowerRotation);
    const y = upperLength * Math.sin(upperRotation) + lowerLength * Math.sin(upperRotation + lowerRotation);
    expect(Math.hypot(x, y)).toBeCloseTo(reach);
    if (target.x) expect(x).toBeCloseTo(reach);
    if (target.y) expect(y).toBeCloseTo(reach);
  });
});

describe("rig commands", () => {
  it("records attributed groups and reverses subtree deletion including constraints", () => {
    const initial = fixture();
    const { getState } = createRigStore(initial);
    getState().dispatch("Attach IK", ai, attach);
    const constrained = getState().rig;
    getState().dispatch("Remove foreleg", human, { type: "bone.remove", id: "upper" });
    expect(getState().rig.bones.map(bone => bone.id)).toEqual(["body"]);
    expect(getState().rig.constraints).toEqual([]);
    expect(getState().past.map(entry => entry.actor)).toEqual([ai, human]);
    getState().undo();
    expect(getState().rig).toEqual(constrained);
    getState().undo();
    expect(getState().rig).toEqual(initial);
    getState().redo();
    getState().redo();
    expect(getState().rig.bones).toHaveLength(1);
    expect(getState().past[1].actor).toEqual(human);
  });

  it("validates batches atomically, keeps redo after failed edits, and clears redo after a new edit", () => {
    const { getState } = createRigStore(fixture());
    getState().dispatch("Attach IK", ai, attach);
    getState().undo();
    const before = getState();
    expect(() => before.dispatch("Invalid connect", human,
      { type: "bone.update", id: "lower", changes: { offset: { x: 3, y: 0 } } }, attach)).toThrow();
    expect(getState()).toBe(before);
    before.dispatch("Resize and connect", human,
      { type: "bone.update", id: "upper", changes: { length: 4 } },
      { type: "bone.update", id: "lower", changes: { offset: { x: 4, y: 0 } } }, attach);
    expect(getState().past).toHaveLength(1);
    expect(getState().future).toEqual([]);
    getState().undo();
    expect(getState().rig).toEqual(fixture());
  });
});
