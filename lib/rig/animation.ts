import { produce } from "immer";
import { z } from "zod";
import { boneSchema, constraintSchema, type KinetixRigState } from "./model";

export const easeSchema = z.strictObject({
  x1: z.number().min(0).max(1),
  y1: z.number().min(-2).max(3),
  x2: z.number().min(0).max(1),
  y2: z.number().min(-2).max(3),
});
export type Ease = z.infer<typeof easeSchema>;
export const linearEase: Ease = { x1: 0, y1: 0, x2: 1, y2: 1 };

export const channelSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("bone"), id: boneSchema.shape.id, property: z.enum(["rotation", "x", "y"]) }),
  z.strictObject({ kind: z.literal("ik"), id: constraintSchema.shape.id, property: z.enum(["x", "y", "enabled"]) }),
]);
export const keyframeSchema = z.strictObject({
  frame: z.int().min(0).max(35_999),
  value: z.number().min(-1_000_000).max(1_000_000),
  easing: easeSchema,
});
export const trackSchema = z.strictObject({ channel: channelSchema, keys: z.array(keyframeSchema).min(1).max(36_000) });
export const tracksSchema = z.array(trackSchema).max(512).superRefine((tracks, context) => {
  const channels = new Set<string>();
  let keyCount = 0;
  for (const [index, track] of tracks.entries()) {
    const id = channelId(track.channel);
    if (channels.has(id)) context.addIssue({ code: "custom", path: [index], message: "Duplicate animation channel." });
    if (track.keys.some((key, keyIndex) => keyIndex > 0 && key.frame <= track.keys[keyIndex - 1].frame)) {
      context.addIssue({ code: "custom", path: [index, "keys"], message: "Keyframes must be in ascending order with one key per frame." });
    }
    channels.add(id);
    keyCount += track.keys.length;
  }
  if (keyCount > 10_000) context.addIssue({ code: "custom", message: "A clip may contain up to 10,000 keyframes." });
});
export type Channel = z.infer<typeof channelSchema>;
export type Keyframe = z.infer<typeof keyframeSchema>;
export type Track = z.infer<typeof trackSchema>;

export function channelId(channel: Channel): string {
  return [channel.kind, channel.id, channel.property].join(":");
}

function bezier(p1: number, p2: number, t: number): number {
  const complement = 1 - t;
  return 3 * complement * complement * t * p1 + 3 * complement * t * t * p2 + t * t * t;
}

/** Solve x(t) for time, then evaluate y(t). Bisection handles flat derivatives at the endpoints. */
export function easingAt(easing: Ease, progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  if (easing.x1 === easing.y1 && easing.x2 === easing.y2) return progress;
  let lower = 0;
  let upper = 1;
  for (let step = 0; step < 28; step++) {
    const time = (lower + upper) / 2;
    if (bezier(easing.x1, easing.x2, time) < progress) lower = time;
    else upper = time;
  }
  return bezier(easing.y1, easing.y2, (lower + upper) / 2);
}

export function sampleTrack(track: Track, frame: number): number {
  const { keys } = track;
  if (frame <= keys[0].frame) return keys[0].value;
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return last.value;
  let left = 0;
  let right = keys.length - 1;
  while (right - left > 1) {
    const middle = Math.floor((left + right) / 2);
    if (frame < keys[middle].frame) right = middle;
    else left = middle;
  }
  const from = keys[left];
  const to = keys[right];
  const progress = easingAt(from.easing, (frame - from.frame) / (to.frame - from.frame));
  return from.value + (to.value - from.value) * progress;
}

export function sampleRig(rig: KinetixRigState, tracks: readonly Track[], frame: number): KinetixRigState {
  if (tracks.length === 0) return rig;
  return produce(rig, draft => {
    const bones = new Map(draft.bones.map(bone => [bone.id, bone]));
    const constraints = new Map(draft.constraints.map(constraint => [constraint.id, constraint]));
    const connected = new Set(draft.constraints.map(constraint => constraint.lowerId));
    for (const track of tracks) {
      const { kind, id, property } = track.channel;
      const value = sampleTrack(track, frame);
      if (kind === "bone") {
        const bone = bones.get(id);
        if (!bone) continue;
        if (property === "rotation") bone.rotation = value;
        else if (!connected.has(id)) bone.offset[property] = value;
      } else {
        const constraint = constraints.get(id);
        if (!constraint) continue;
        if (property === "enabled") constraint.enabled = value >= 0.5;
        else constraint.target[property] = value;
      }
    }
  });
}

export function setKey(tracks: Track[], channel: Channel, frame: number, value: number): Track[] {
  const id = channelId(channel);
  const existing = tracks.find(track => channelId(track.channel) === id);
  const original = existing?.keys.find(key => key.frame === frame);
  const key = keyframeSchema.parse({ frame, value, easing: original?.easing ?? linearEase });
  if (!existing) return [...tracks, { channel, keys: [key] }];
  const keys = [...existing.keys.filter(item => item.frame !== frame), key].sort((a, b) => a.frame - b.frame);
  return tracks.map(track => track === existing ? { ...track, keys } : track);
}

export function removeKey(tracks: Track[], channel: Channel, frame: number): Track[] {
  return tracks.flatMap(track => {
    if (channelId(track.channel) !== channelId(channel)) return [track];
    const keys = track.keys.filter(key => key.frame !== frame);
    return keys.length ? [{ ...track, keys }] : [];
  });
}

export function setKeyEase(tracks: Track[], channel: Channel, frame: number, ease: Ease): Track[] {
  const easing = easeSchema.parse(ease);
  return tracks.map(track => channelId(track.channel) === channelId(channel) ?
    { ...track, keys: track.keys.map(key => key.frame === frame ? { ...key, easing } : key) } : track);
}
