# Kinetix PixiJS starter

The PixiJS profile version 1 uses PixiJS 8.23.0 and the Kinetix version 2 portable sprite bundle. It preserves named clips, directions, frame holds, cues, sockets and collision data across loose PNGs, fixed grids and packed atlas pages.

1. Export **Portable sprite bundle (ZIP)** in Kinetix Studio.
2. Extract the PixiJS starter ZIP. With Node.js 24 or later, run `npm ci` and `npm run dev` in that folder.
3. Select the sprite ZIP. Review the added, updated and retained clips, then select **Apply import**. Change direction with the clip picker. The green marker follows the first socket in the selected frame.
4. Run `npm run build` to deploy the starter. Serve its `dist` folder and open `/integrations/pixi/starter/` over HTTPS or on localhost. Files are validated and played in the browser.

## Add the importer to a game

Copy `integrations/pixi/kinetix-sprites.ts` and the two included files under `lib/`, keeping their relative paths. Install the PixiJS, fflate and Zod versions from `package.json`. Create a library for each rig after initializing your `Application`.

```ts
const library = new KinetixPixiLibrary(app);
const bytes = new Uint8Array(await file.arrayBuffer());
const plan = await library.previewImport(bytes);
const result = await library.importBundle(bytes, plan.baseHash);
const actor = library.createSprite(result.clipIds[0]);
actor.position.set(160, 120);
app.stage.addChild(actor);
actor.on("kinetix-cue", ({ cue }) => {
  if (cue.name === "footfall") playSound("step");
});
```

Store source clip IDs from `listClips()` in game state. Use `playClip(id)` to switch clips and directions. The application ticker advances authored time, including repeat, once and ping-pong loops. Paused actors can be sampled with `seek(tick)` without triggering skipped cues, or advanced with `advanceTicks` for deterministic event delivery. Cue payloads and frame IDs are passed to `kinetix-cue` listeners. `socket(name)` and `collisions()` use pivot-relative scene coordinates with positive Y down. Attach props as children or use `actor.toGlobal(point)` to position them in world space.

Reimport into the same library to keep actors, listeners, attachments and game transforms. Clip renames and atlas repacks keep source IDs. Omitted clips remain usable and appear under `retained`. Passing the preview's `baseHash` protects against applying a stale preview after a different revision was imported. `importBundle` returns the source revision, package SHA-256, clip IDs, import plan and target profile. The library releases its textures and actor ticker callbacks when destroyed. Use the portable Kinetix project to hand off editable vectors, rigs and keyframes.
