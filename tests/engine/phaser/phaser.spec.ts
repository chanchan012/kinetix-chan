import { expect, test } from "@playwright/test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { PNG } from "pngjs";
import { exportedAtlasFixture } from "../../fixtures/sprite-atlas";
import { spriteBundleManifest } from "../../../lib/export/sprite-playback";

type Layout = Parameters<typeof exportedAtlasFixture>[0];

async function fixture(layout: Layout, scale = 1, update = false) {
  const files = unzipSync(await exportedAtlasFixture(layout, scale));
  const manifest = spriteBundleManifest.parse(JSON.parse(strFromU8(files["kinetix.json"])));
  const [east, west] = manifest.clips;
  west.frames[1].events = [{ name: "stride", tick: 1, data: { foot: "left" } }];
  if (update) {
    const used = new Set(east.frames.map(frame => frame.file));
    for (const file of manifest.files) if (!used.has(file.file)) delete files[file.file];
    manifest.clips = [east];
    manifest.files = manifest.files.filter(file => used.has(file.file));
    manifest.textureBytes = manifest.files.reduce((sum, file) => sum + file.width * file.height * 4, 0);
    manifest.source.revision++;
    east.name = "Bright flicker";
  }
  files["kinetix.json"] = strToU8(JSON.stringify(manifest));
  return { bytes: [...zipSync(files)], east: east.id, west: west.id };
}

for (const renderer of ["canvas", "webgl"] as const) {
  test(`${renderer} plays and revises portable sprite bundles with stable game objects`, async ({ page }) => {
    test.skip(!!process.env.KINETIX_PHASER_TEST_URL, "The downloaded starter is covered by the standalone smoke test.");
    await page.goto(`/tests/engine/phaser/receiver.html?${renderer}`);
    await page.waitForFunction(() => window.receiver);
    expect(await page.evaluate(() => [window.receiver.version, window.receiver.renderer])).toEqual(["3.90.0", renderer === "webgl" ? 2 : 1]);
    const { east, west } = await fixture("packed");
    const canvas = page.locator("canvas");
    let reference: Buffer | undefined;
    for (const layout of ["loose", "fixed-grid", "packed"] as const) {
      const { bytes } = await fixture(layout);
      const receipt = await page.evaluate(bytes => window.receiver.importBytes(bytes), bytes);
      expect(receipt).toMatchObject({ layout, profile: { version: 1, phaser: "3.90.0" }, clipIds: [east, west] });
      const details = await page.evaluate(east => {
        const actor = window.receiver.actor!;
        actor.playClip(east).setPlaying(false).setScale(1.25);
        return { duration: actor.currentFrame.durationTicks, socket: actor.socket("glow"), collisions: actor.collisions() };
      }, east);
      expect(details).toEqual({ duration: 100, socket: { x: 0, y: -5, angle: 0.5 },
        collisions: [{ kind: "rect", name: "hot", x: -2, y: -8, width: 3, height: 4 }] });
      const capture = await canvas.screenshot({ omitBackground: true });
      const rendered = PNG.sync.read(capture);
      const pixels = rendered.data;
      const anchorPixel = (47 * rendered.width + 71) * 4;
      expect(pixels[anchorPixel]).toBeGreaterThan(100);
      expect(pixels[anchorPixel + 3]).toBeGreaterThan(100);
      if (reference) expect(pixels).toEqual(reference);
      reference ??= pixels;
      await page.evaluate(() => window.receiver.actor!.seek(100));
      const blank = PNG.sync.read(await canvas.screenshot({ omitBackground: true })).data;
      expect(blank.every((value, i) => i % 4 !== 3 || value === 0)).toBe(true);
    }

    const plays = await page.evaluate(({ east, west }) => {
      const { actor, cues } = window.receiver;
      actor!.playClip(east).setPlaying(false).advanceTicks(60).advanceTicks(40);
      const atBlank = actor!.currentFrame.blank;
      actor!.advanceTicks(1000);
      const onceEnds = actor!.currentFrame.sourceFrame;
      actor!.playClip(west).setPlaying(false).advanceTicks(8);
      const atLoop = actor!.currentFrame.sourceFrame;
      return { atBlank, onceEnds, atLoop, cues: cues.map(({ cue }) => [cue.name, cue.data]) };
    }, { east, west });
    expect(plays).toEqual({ atBlank: true, onceEnds: 2, atLoop: 0,
      cues: [["ignite", { flammable: true }], ["stride", { foot: "left" }], ["stride", { foot: "left" }]] });

    const { bytes: revised } = await fixture("packed", 2, true);
    const reimport = await page.evaluate(async ({ east, revised }) => {
      const { actor, scene, library, cues } = window.receiver;
      actor!.playClip(east).setPlaying(false).setPosition(72, 56).setScale(1.25);
      const attachment = scene.add.circle(14, 18, 2);
      attachment.setVisible(false);
      actor!.add(attachment);
      const beforeFailedUpdate = scene.textures.getTextureKeys().length;
      const addCanvas = scene.textures.addCanvas;
      let prepared = 0;
      scene.textures.addCanvas = function (...args) {
        if (++prepared === 2) return null;
        return addCanvas.apply(this, args);
      };
      let rolledBack;
      try {
        rolledBack = await window.receiver.importBytes(revised).then(() => false, () => true);
      } finally {
        scene.textures.addCanvas = addCanvas;
      }
      const keptAfterFailure = scene.textures.getTextureKeys().length === beforeFailedUpdate &&
        library.listClips().every(clip => clip.name === "Flicker");
      const receipt = await window.receiver.importBytes(revised);
      const textureCount = scene.textures.getTextureKeys().length;
      await window.receiver.importBytes(revised);
      const duplicateCount = scene.textures.getTextureKeys().length;
      const rejected = await window.receiver.importBytes([0, 1, 2]).then(() => false, () => true);
      actor!.advanceTicks(60);
      return { receipt, textureCount, duplicateCount, rejected, rolledBack, keptAfterFailure,
        actorPreserved: actor === window.receiver.actor,
        attachmentPreserved: attachment.parentContainer === actor, position: [actor!.x, actor!.y, actor!.scaleX],
        clips: library.listClips(), socket: actor!.socket("glow"), lastCue: cues.at(-1)?.cue.name };
    }, { east, revised });
    expect(reimport.receipt).toMatchObject({ revision: 8, keptClipIds: [west] });
    expect(reimport).toMatchObject({ textureCount: reimport.duplicateCount, rejected: true, rolledBack: true,
      keptAfterFailure: true, actorPreserved: true,
      attachmentPreserved: true, position: [72, 56, 1.25], socket: { x: 0, y: -5 }, lastCue: "ignite",
      clips: [{ id: west, name: "Flicker", direction: "west" }, { id: east, name: "Bright flicker", direction: "east" }] });
    const unchanged = PNG.sync.read(await canvas.screenshot({ omitBackground: true })).data;
    expect(unchanged.some((value, i) => i % 4 === 3 && value > 0)).toBe(true);
  });
}

test("standalone starter opens a sprite ZIP and keeps playable clips after invalid input", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/integrations/phaser/starter/");
  await expect(page.locator("canvas")).toBeVisible();
  const upload = page.getByLabel("Portable sprite ZIP");
  const { bytes, west } = await fixture("packed");
  await upload.setInputFiles({ name: "flame.zip", mimeType: "application/zip", buffer: Buffer.from(bytes) });
  await expect(page.getByRole("status")).toHaveText("Imported 2 clips from packed.");
  const select = page.getByLabel("Clip and direction");
  await expect(select.getByRole("option")).toHaveText(["Flicker · east", "Flicker · west"]);
  await select.selectOption(west);
  await expect(page.getByText("stride", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeEnabled();
  await upload.setInputFiles({ name: "invalid.zip", mimeType: "application/zip", buffer: Buffer.from([1, 2, 3]) });
  await expect(page.getByRole("status")).not.toContainText("Imported");
  await expect(select).toHaveValue(west);
  expect(errors).toEqual([]);
});
