import { expect, test } from "vitest";
import { compileSpriteTimeline, spriteCuesBetween } from "../../integrations/phaser/timeline";
import { openSpriteBundle } from "../../lib/export/sprite-playback";
import { exportedAtlasFixture } from "../fixtures/sprite-atlas";

test("Phaser cue windows preserve one-shot, repeat and ping-pong loop boundaries", async () => {
  const { manifest } = await openSpriteBundle(await exportedAtlasFixture());
  const [once, source] = manifest.clips;
  const onceTimeline = compileSpriteTimeline(once);
  expect([...spriteCuesBetween(onceTimeline, -1, 60)].map(({ tick }) => tick)).toEqual([60]);
  expect([...spriteCuesBetween(onceTimeline, 60, 800)]).toEqual([]);

  const frames = structuredClone(source.frames);
  frames[0].events = [{ name: "start", tick: 0 }];
  frames[1].events = [{ name: "step", tick: 1 }];
  const loopEvents = (mode: "repeat" | "ping-pong", from: number, to: number) =>
    [...spriteCuesBetween(compileSpriteTimeline({ ...source, loopMode: mode, frames }), from, to)]
      .map(({ tick, event }) => [tick, event.cue.name]);
  expect(loopEvents("repeat", -1, 8)).toEqual([[0, "start"], [4, "step"], [6, "start"]]);
  expect(loopEvents("ping-pong", -1, 8)).toEqual([[0, "start"], [4, "step"], [7, "step"], [8, "start"]]);
  expect(loopEvents("ping-pong", 4, 7)).toEqual([[7, "step"]]);
  expect(loopEvents("ping-pong", 7, 8)).toEqual([[8, "start"]]);
});
