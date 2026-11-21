# Kinetix Phaser starter

The Kinetix Phaser sprite profile version 1 uses Phaser 3.90.0 and a version 2 Kinetix portable sprite ZIP. It plays loose PNGs, fixed grids and packed atlas pages with the authored timing. Use Node.js 24 or later for the starter's build tools.

1. Export **Portable sprite bundle (ZIP)** from Kinetix Studio.
2. Extract `kinetix-phaser-starter.zip` into its own folder. In that folder run `npm ci`, then `npm run dev`.
3. Open the page that Vite launches. Choose the exported sprite ZIP, select a clip and direction, and use **Play** or **Pause**. The green dot follows the first socket on the active frame. The panel shows the last cue and the imported revision.
4. To deploy the example, run `npm run build` and serve `dist` with a static server. Open `/integrations/phaser/starter/` on localhost or HTTPS. Local import and playback require no Kinetix session.

## Integrate with an existing game

Copy `integrations/phaser/kinetix-sprites.ts`, `integrations/phaser/timeline.ts` and the two included files under `lib/`, preserving their paths. Install the Phaser, fflate and Zod versions in the included package manifest. With your TypeScript bundler, instantiate one `KinetixPhaserLibrary` per rig in the scene.

```ts
const library = new KinetixPhaserLibrary(this);
const receipt = await library.importBundle(new Uint8Array(await file.arrayBuffer()));
const clip = library.listClips().find(entry => entry.direction === "east");
const actor = library.createSprite(160, 120, clip?.id ?? receipt.clipIds[0]);
actor.on("kinetix-cue", ({ cue }) => {
  if (cue.name === "footfall") this.sound.play("step");
});
```

Use `actor.playClip(id)` to change direction or start an action by its saved ID. The Phaser scene update clock runs once, repeat and ping-pong clips. Manual `seek` changes the visible frame without invoking cues. Pause with `setPlaying(false)` and call `advanceTicks` to test a known number of source ticks. Cue delivery includes authored payloads and delivers the interior holds in both directions of a ping-pong loop.

Treat the returned container as the game-owned actor. Change its transform or add game objects without changing the sprite art. `socket(name)` and `collisions()` return pivot-relative data in scene units, with positive Y down. Use Phaser's world transform to attach an external object, or add the attachment as a child of the returned container. Choose how to apply collision data to your physics system. `currentFrame` also includes the original origin and holds in source coordinates.

Reimport a new export into the same library to apply a revision. Existing containers, selected clip IDs, placement, and cue listeners stay in place. A partial export keeps omitted clips. Repeated identical imports and invalid updates leave the current textures intact. The receipt records the profile and Phaser version, source revision, SHA-256 of the ZIP, active clip IDs and retained clip IDs. Texture manager keys are internal. Use clip and frame IDs for persistent game references.

The adapter bakes the visible frame into isolated Phaser textures to support rotation and fractional filtering without atlas bleed. It normalizes linear or premultiplied input to straight sRGB. Keep the Kinetix editable project when handing off authoring data such as bone weights, curves and vector paths.
