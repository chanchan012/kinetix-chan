import { describe, expect, it } from "vitest";
import { easingAt, linearEase, removeKey, sampleRig, sampleTrack, setKey, setKeyEase, tracksSchema } from "../../lib/rig/animation";
import { createRigState } from "../../lib/rig/model";

describe("clip interpolation", () => {
  it("evaluates Bézier easing against the x coordinate and supports overshoot", () => {
    expect(easingAt(linearEase, 0.33)).toBe(0.33);
    expect(easingAt({ x1: 1 / 3, y1: 0, x2: 2 / 3, y2: 0 }, 0.5)).toBeCloseTo(0.125, 7);
    expect(easingAt({ x1: 0.25, y1: 2, x2: 0.75, y2: 2 }, 0.5)).toBeGreaterThan(1);
    expect(easingAt({ x1: 0, y1: 1, x2: 0, y2: 1 }, 0.01)).toBeGreaterThan(0.4);
  });

  it("applies fractional frame samples without changing the authored rig", () => {
    const rig = createRigState("heron");
    const channel = { kind: "bone", id: "upper", property: "rotation" } as const;
    const tracks = setKey(setKey([], channel, 10, Math.PI), channel, 2, 0);
    expect(sampleTrack(tracks[0], 1)).toBe(0);
    expect(sampleTrack(tracks[0], 6.5)).toBeCloseTo(9 * Math.PI / 16);
    expect(sampleTrack(tracks[0], 15)).toBe(Math.PI);
    expect(sampleRig(rig, tracks, 6).bones[1].rotation).toBeCloseTo(Math.PI / 2);
    expect(rig.bones[1].rotation).toBe(-2.6);
  });

  it("keeps existing easing on replacement and validates unique channels and frames", () => {
    const channel = { kind: "ik", id: "foot", property: "x" } as const;
    const ease = { x1: 0.2, y1: 0, x2: 0.9, y2: 1 };
    const tracks = setKeyEase(setKey([], channel, 10, 22), channel, 10, ease);
    const edited = setKey(tracks, channel, 10, 40);
    expect(edited[0].keys).toEqual([{ frame: 10, value: 40, easing: ease }]);
    expect(tracksSchema.safeParse([edited[0], edited[0]]).success).toBe(false);
    expect(removeKey(edited, channel, 10)).toEqual([]);
  });
});
