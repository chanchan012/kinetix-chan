import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import { engineSpriteFixture } from "../../fixtures/engine-sprites";

for (const [renderer, typeId] of [["canvas", 4], ["webgl", 1], ["webgpu", 2]] as const) {
  test(`${renderer} renders and revises sprites in the PixiJS receiver`, async ({ page }) => {
    test.skip(!!process.env.KINETIX_PIXI_TEST_URL, "The downloaded starter is covered by the standalone smoke test.");
    await page.goto(`/tests/engine/pixi/receiver.html?renderer=${renderer}`);
    await page.waitForFunction(() => window.pixiReceiver || window.pixiInitError);
    expect(await page.evaluate(() => window.pixiInitError)).toBeUndefined();
    expect(await page.evaluate(() => [window.pixiReceiver.version, window.pixiReceiver.app.renderer.type])).toEqual(["8.23.0", typeId]);
    const { east, west } = await engineSpriteFixture("packed");
    const canvas = page.locator("canvas");
    const capture = async () => PNG.sync.read(await canvas.screenshot({ omitBackground: true }));
    let reference: Buffer | undefined;
    for (const layout of ["loose", "fixed-grid", "packed"] as const) {
      const { bytes } = await engineSpriteFixture(layout);
      const receipt = await page.evaluate(bytes => window.pixiReceiver.importBytes(bytes), bytes);
      expect(receipt).toMatchObject({ layout, profile: { version: 1, pixi: "8.23.0" }, clipIds: [east, west] });
      const details = await page.evaluate(east => {
        const { app, actor } = window.pixiReceiver;
        actor!.playClip(east).setPlaying(false);
        app.render();
        return { duration: actor!.currentFrame.durationTicks, socket: actor!.socket("glow"), collisions: actor!.collisions() };
      }, east);
      expect(details).toEqual({ duration: 100, socket: { x: 0, y: -5, angle: 0.5 },
        collisions: [{ kind: "rect", name: "hot", x: -2, y: -8, width: 3, height: 4 }] });
      const rendered = await capture();
      const offset = (47 * rendered.width + 71) * 4;
      expect(rendered.data[offset]).toBeGreaterThan(100);
      expect(rendered.data[offset + 3]).toBeGreaterThan(100);
      if (reference) expect(rendered.data).toEqual(reference);
      reference ??= rendered.data;
      await page.evaluate(() => {
        window.pixiReceiver.actor!.seek(100);
        window.pixiReceiver.app.render();
      });
      expect((await capture()).data.every((value, index) => index % 4 !== 3 || value === 0)).toBe(true);
    }

    const result = await page.evaluate(({ east, west }) => {
      const { actor, cues } = window.pixiReceiver;
      actor!.playClip(east).setPlaying(false).advanceTicks(60).advanceTicks(40);
      const atBlank = actor!.currentFrame.blank;
      actor!.advanceTicks(1000);
      const onceEnds = actor!.currentFrame.sourceFrame;
      actor!.playClip(west).setPlaying(false).advanceTicks(8);
      return { atBlank, onceEnds, atLoop: actor!.currentFrame.sourceFrame, cues: cues.map(({ cue }) => [cue.name, cue.data]) };
    }, { east, west });
    expect(result).toEqual({ atBlank: true, onceEnds: 2, atLoop: 0,
      cues: [["ignite", { flammable: true }], ["stride", { foot: "left" }], ["stride", { foot: "left" }]] });

    const { bytes: old } = await engineSpriteFixture("loose");
    const { bytes: revised } = await engineSpriteFixture("packed", 2, true);
    const reimport = await page.evaluate(async ({ east, revised, old }) => {
      const { app, actor, library, cues, createProp } = window.pixiReceiver;
      actor!.playClip(east).setPlaying(false);
      const prop = createProp();
      prop.visible = false;
      actor!.addChild(prop);
      const art = actor!.getChildAt(0) as import("pixi.js").Sprite;
      const previousTexture = art.texture;
      const originalPlan = await library.previewImport(Uint8Array.from(old));
      const plan = await library.previewImport(Uint8Array.from(revised));
      const textureSystem = app.renderer.texture;
      const init = textureSystem.initSource;
      const initialize = init.bind(textureSystem);
      const staged: Array<{ destroyed: boolean }> = [];
      textureSystem.initSource = (source => {
        staged.push(source);
        if (staged.length === 2) throw new Error("Texture initialization failed in the fixture");
        return initialize(source);
      }) as typeof init;
      let failure;
      try {
        failure = await window.pixiReceiver.importBytes(revised).then(() => false, () => true);
      } finally {
        textureSystem.initSource = init;
      }
      const oldAssetPlayable = previousTexture === art.texture && !previousTexture.destroyed &&
        library.listClips().every(clip => clip.name === "Flicker");
      const receipt = await window.pixiReceiver.importBytes(revised, plan.baseHash);
      const texture = art.texture;
      const repeated = await window.pixiReceiver.importBytes(revised);
      const stale = await window.pixiReceiver.importBytes(old, originalPlan.baseHash).then(() => false, () => true);
      const rejected = await window.pixiReceiver.importBytes([0, 1, 2]).then(() => false, () => true);
      actor!.advanceTicks(60);
      app.render();
      return { plan, receipt, repeated: repeated.identical, stale, rejected, failure, oldAssetPlayable,
        releasedStaging: staged.length === 2 && staged.every(source => source.destroyed),
        sameTexture: texture === art.texture, actorPreserved: actor === window.pixiReceiver.actor && actor!.parent === app.stage,
        propPreserved: prop.parent === actor, transform: [actor!.x, actor!.y, actor!.scale.x],
        socket: actor!.socket("glow"), lastCue: cues.at(-1)?.cue.name };
    }, { east, revised, old });
    expect(reimport.plan).toMatchObject({ added: [], updated: [{ before: { id: east, name: "Flicker" },
      after: { id: east, name: "Bright flicker" } }], retained: [{ id: west }] });
    expect(reimport.receipt).toMatchObject({ revision: 8, clipIds: [east] });
    expect(reimport).toMatchObject({ repeated: true, stale: true, rejected: true, failure: true, oldAssetPlayable: true,
      releasedStaging: true, sameTexture: true, actorPreserved: true, propPreserved: true, transform: [72, 56, 1.25],
      socket: { x: 0, y: -5 }, lastCue: "ignite" });
    expect((await capture()).data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    expect(await page.evaluate(() => {
      const { app, actor } = window.pixiReceiver;
      app.destroy();
      return actor!.destroyed;
    })).toBe(true);
  });
}

test("standalone starter previews and applies a sprite bundle before playing it", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", error => failures.push(error.message));
  await page.goto("/integrations/pixi/starter/");
  const upload = page.getByLabel("Portable sprite ZIP");
  await expect(upload).toBeEnabled();
  const { bytes, west } = await engineSpriteFixture("packed");
  const file = { name: "flame.zip", mimeType: "application/zip", buffer: Buffer.from(bytes) };
  await upload.setInputFiles(file);
  const preview = page.getByRole("region", { name: "Import preview" });
  await expect(preview.getByRole("listitem")).toHaveText(["Add Flicker · east", "Add Flicker · west"]);
  const select = page.getByLabel("Clip and direction");
  await expect(select).toBeDisabled();
  await preview.getByRole("button", { name: "Cancel" }).click();
  await expect(preview).toBeHidden();
  await upload.setInputFiles(file);
  await preview.getByRole("button", { name: "Apply import" }).click();
  await expect(page.getByRole("status")).toHaveText("Imported 2 clips from packed.");
  await select.selectOption(west);
  await expect(page.getByText("stride", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause" }).click();
  await upload.setInputFiles({ name: "bad.zip", mimeType: "application/zip", buffer: Buffer.from([0, 1, 2]) });
  await expect(page.getByRole("status")).not.toContainText("Imported");
  await expect(select).toHaveValue(west);
  expect(failures).toEqual([]);
});
