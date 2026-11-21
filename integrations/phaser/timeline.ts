import type { PlaybackClip, PlaybackFrame } from "../../lib/export/sprite-playback";

export type SpriteCue = { clipId: string; frameId: string; cue: PlaybackFrame["events"][number] };

export function compileSpriteTimeline(clip: PlaybackClip) {
  const visits = [...clip.frames];
  if (clip.loopMode === "ping-pong") visits.push(...clip.frames.slice(1, -1).reverse());
  let period = 0;
  const cues = visits.flatMap(frame => {
    const start = period;
    period += frame.durationTicks;
    return frame.events.toSorted((a, b) => a.tick - b.tick).map(cue => ({
      tick: start + cue.tick,
      event: { clipId: clip.id, frameId: frame.id, cue },
    }));
  });
  return { period, cues, repeats: clip.loopMode !== "once" };
}

export function* spriteCuesBetween(timeline: ReturnType<typeof compileSpriteTimeline>, from: number, to: number) {
  if (!timeline.cues.length) return;
  const firstLoop = Math.floor(Math.max(0, from) / timeline.period);
  const lastLoop = timeline.repeats ? Math.floor(to / timeline.period) : 0;
  for (let loop = firstLoop; loop <= lastLoop; loop++) {
    const start = loop * timeline.period;
    for (const { tick, event } of timeline.cues) {
      const absoluteTick = start + tick;
      if (absoluteTick > to) break;
      if (absoluteTick > from) yield { tick: absoluteTick, event };
    }
  }
}
