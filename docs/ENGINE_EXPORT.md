# Sprite package delivery

The Godot 4.5.1 adapter reads all three version 2 layouts and the version 1 fixed-grid ZIP. Version 2 portable bundles contain multiple clips and support independent PNGs, fixed grids and packed atlases. The Kinetix reference player reads all three version 2 layouts.

## Portable bundles

In Studio Export, choose **Portable sprite bundle (ZIP)**. Select clips, set each source range, and choose the layout and texture options. **Check export** reports the number and size of PNG files and the estimated RGBA texture memory. Save the ZIP and open it in [the sprite player](https://kinetix-chan.vercel.app/sprite-player). The player decodes the ZIP locally and restores each sprite to its original frame before scaling.

Image placements set to **Artwork and exports** are baked into sprite frames, including placements attached to bones. **Reference only** placements stay in the editable project. Relink missing visible artwork from **Image assets** before delivering a sprite bundle.

| Layout | Files | Frame geometry |
| --- | --- | --- |
| Loose PNG frames | `frames/00001.png` and subsequent files | Each file contains the full source frame. |
| Fixed-grid sheets | `atlas/001.png` and further sheets at the selected texture limit | Row-major cells use the full source size, with blank frames included. |
| Packed atlas pages | `atlas/001.png` and further pages | Alpha trimming, optional clockwise rotation, transparent padding and edge extrusion. Identical pixel crops share rectangles. |

`kinetix.json` contains `source` with the project ID, saved art revision and pixel scale, and one entry per PNG in `files` with dimensions, byte size and SHA-256. Each clip includes its ID, saved track revision, name, optional direction, loop mode, ticks per second, and duration. Each frame includes its stable ID, source frame index, start and duration in ticks, source size, origin, pivot, blank flag, texture rectangle, rotation, trim offset, sockets, collisions and events.

Use the JSON Schema for field and type validation. An importer must also verify PNG checksums, rectangle bounds, and each clip's cumulative timing. [Version 2 JSON Schema](https://kinetix-chan.vercel.app/sprite-player/schema).

Use the clip timebase to advance the frame. Repeat wraps at the end. Ping-pong plays the interior holds in reverse after the last frame. A once clip stops on its last frame. Event ticks are relative to their frame's start. Source-pixel metadata uses a top-left origin with positive Y down. Angle values are radians. Texture rectangles use page pixels. Rotate a stored 90° rectangle counterclockwise to recover the logical crop, then place it at its trim offset. Draw the full frame at the world anchor minus the pivot. Apply the inverse of `source.pixelScale` to preserve artboard-world dimensions when changing the export scale.

The texture settings declare nearest or linear filtering, sRGB or linear color, and straight or premultiplied alpha. For fractional draws, isolate a sprite's logical crop or clamp sampling at its edge. Premultiplied PNG channel values follow the bundle's metadata, so a standard PNG viewer interpreting all channels as straight alpha can display those textures differently.

### REST and MCP

Use `POST /api/rigs/:id/sprite-bundle` or MCP `export_sprite_bundle`. Both accept the art `revision`, unique entries in `clips` with saved IDs and `trackRevision`, a zero-based inclusive frame range for each clip, and the same layout and texture options. `preflight: true` returns the packing plan. Download output includes the ZIP or its base64 representation and file digests.

The request can supply per-frame metadata. This example makes source frame 0 hold for four ticks and emits a cue on tick 2.

```json
[
  {
    "frame": 0,
    "durationTicks": 4,
    "sockets": [{"name": "hand", "x": 18, "y": 12, "angle": 0}],
    "collisions": [{"kind": "rect", "name": "body", "x": 8, "y": 6, "width": 16, "height": 20}],
    "events": [{"name": "spark", "tick": 2, "data": {"intensity": 1}}]
  }
]
```

The direct bundle supports up to 96 frames, 16 clips, 16 megapixels across output textures and a 1.5 MB ZIP. For large scenes, select shorter ranges, reduce pixel scale or use smaller bundles by animation group.

## Reopen sprites as editable cels

Choose **Layers → Import sprite bundle** for a Kinetix version 2 ZIP. All three layouts are supported, including rotated and trimmed packed rectangles. Use a blank transparent design at the source dimensions for an isolated round trip. Import restores the art at its original pixel coordinates, creates editable drawing exposures and opens the first clip. Source delays become integer tick holds in the Studio timeline.

Turn on **Preserve imported timing and frame metadata** when exporting the imported clips. Studio enables this option by default. With REST or MCP, pass `preserveImportedTiming: true` on the clip request and use the inclusive Studio tick range. Existing holds and newly edited exposures determine the sample boundaries. Pose or transform key tracks are sampled at every selected tick. The manifest uses contiguous sample IDs, and `startTick` and `durationTicks` carry the exact playback schedule. Event ticks are relative to the emitted hold.

The preserved mode carries direction, loop mode, pivots, origins, sockets, collisions, cues and source world scale. Export samples the visible composition, including the background and other visible layers. Bundles with different original pixel scales require separate preserved exports. Turn off preservation to author new export metadata. Imports normalize linear or premultiplied textures to straight sRGB channel values, which can introduce rounding.

## Version 1 Godot export

Create a design and save a clip. Select a path to animate its local X or Y offset. Save the artwork and keys, then open **Export** and choose **Sprite package (ZIP)**. Set the frame range, pivot, texture filtering and loop behavior.

The pivot uses artboard coordinates in pixels. Moving it changes which point of the image lands on the imported node's origin. Use bottom center for a character standing on the ground. The atlas contains original-size frames, including blank frames. Frame duration ticks are measured at the clip's frame rate.

## Import and update in Godot 4.5.1

Download the [Godot importer](https://kinetix-chan.vercel.app/sprite-player/godot). Extract the three `.gd` files into the same folder in your Godot project. In the command below, substitute your Godot executable, project folder, downloaded sprite ZIP and script path.

```text
godot --headless --path <game-project> --script res://tools/import_sprite_package.gd -- <downloaded-zip>
```

The version 2 receipt lists the multi-clip `SpriteFrames` resource and `AnimatedSprite2D` scene under `res://kinetix_generated/<rigId>/`, plus their single-clip counterparts under each clip ID. The latter preserve the corresponding version 1 paths and keys. A new key is derived from the clip name and optional direction. Reimports retain keys by clip ID even when the clip name changes, and the receipt distinguishes the aggregate `key` from its `singleKey`. An omitted clip is listed in `omittedClipIds`. Its single-clip assets and key reservation remain available if it returns in a later bundle.

Instance `sprite.tscn` as a child of a game-owned scene. Keep placement, scripts and behavior in the game-owned scene. At runtime, call `play_kinetix_clip(clip_id)` or use the receipt key with `play()`. Godot applies per-frame offsets, pixel-scale compensation and the bundle's texture filter. Each crop uses an isolated texture, so linear sampling cannot bleed across atlas neighbors. The importer converts premultiplied or linear channel data for ordinary Godot 2D rendering.

The generated node emits `kinetix_event(clip_id, frame_id, cue, data)` during playback, including on both passes through an interior ping-pong hold. Pause before scrubbing. `kinetix_frame_data()` returns the active frame metadata, including authored collision geometry. `kinetix_socket_transform(name)` returns a transform relative to the sprite so the game can place attachments. Collision bodies and attachment nodes can be created on the game side using those values.

Version 2 validates ZIP sizes, texture digests, bounds and timing before publishing resources. Concurrent imports of the same rig are serialized by a lock directory. Changed resources are staged before replacement, and the importer restores previous files if a replacement fails. Identical cropped textures share a generated resource. Reimport the same package to rebuild the generated set after a forcibly interrupted import, following the recovery instructions in the [importer README](../integrations/godot/README.md).

## Import and update in Phaser 3.90.0

Open the sprite player and choose **Phaser starter** to download the ZIP. The first release is available in the Vercel preview while production waits for the build limit to reset. Extract the ZIP and run `npm ci`, then `npm run dev`, with Node.js 24. Upload a version 2 portable sprite ZIP in the starter and select a named clip and direction. Chrome verification covers Phaser Canvas and WebGL, all three package layouts, fractional scale, exact frame holds, cue delivery and reimport. [Phaser release preview](https://kinetix-chan-l26n5z98k-chanchans-projects-aada625f.vercel.app/sprite-player)

In an existing game, create a `KinetixPhaserLibrary` in your scene, call `importBundle(bytes)` and `createSprite(x, y, clipId)`. Use the returned container for placement and game-owned children. Bind `kinetix-cue` for frame events. `socket(name)` and `collisions()` return pivot-relative metadata in scene units after conversion from export pixels. A partial reimport keeps the omitted clips, and renamed clips retain their saved IDs. Import setup, calls and reimport behavior are documented in the [starter README](../integrations/phaser/README.md).

## MCP and other engines

Use `rig-hierarchy` for the art revision and `timeline-summary` for the selected clip revision. Call `export_sprite_package` with the clip ID, both revisions, and a zero-based inclusive range. Optional settings include `pivot`, `loop` and `filter`. Set `preflight: true` to inspect the manifest without rendering. For a download, decode `structuredContent.base64` and save the returned filename.

Other importers can read `kinetix.json`, verify the atlas digest and read each rectangle from `atlas.png`. Use `durationTicks / clip.fps` for frame duration and place the art relative to its pivot. When using linear filtering, clamp texture sampling to the frame rectangle. This profile represents one clip. For multi-clip exports and packed atlases, use the version 2 bundle.
