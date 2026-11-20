# Sprite package delivery

The Godot 4.5.1 adapter reads the version 1 fixed-grid ZIP. Version 2 portable bundles contain multiple clips and support independent PNGs, fixed grids and packed atlases. The Kinetix reference player reads all three version 2 layouts.

## Portable bundles

In Studio Export, choose **Portable sprite bundle (ZIP)**. Select clips, set each source range, and choose the layout and texture options. **Check export** reports the number and size of PNG files and the estimated RGBA texture memory. Save the ZIP and open it in [the sprite player](https://kinetix-chan.vercel.app/sprite-player). The player decodes the ZIP locally and restores each sprite to its original frame before scaling.

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

## Version 1 Godot export

Create a design and save a clip. Select a path to animate its local X or Y offset. Save the artwork and keys, then open **Export** and choose **Sprite package (ZIP)**. Set the frame range, pivot, texture filtering and loop behavior.

The pivot uses artboard coordinates in pixels. Moving it changes which point of the image lands on the imported node's origin. Use bottom center for a character standing on the ground. The atlas contains original-size frames, including blank frames. Frame duration ticks are measured at the clip's frame rate.

## Import and update

Copy `integrations/godot/import_sprite_package.gd` into your Godot project as `res://tools/import_sprite_package.gd`. In the command below, substitute your Godot executable, project folder, and downloaded ZIP.

```text
godot --headless --path <game-project> --script res://tools/import_sprite_package.gd -- <downloaded-zip>
```

The importer emits the paths for the `SpriteFrames` resource and the playable `AnimatedSprite2D` scene under `res://kinetix_generated/<rigId>/<clipId>/`. Instance `sprite.tscn` as a child of a game-owned scene and put your placement, scripts and game behavior on the parent. Reimport the same clip to update its generated assets at the same paths. Preserve the original clip when changing its name, artwork or timing so its ID and references carry forward. The generated scene takes updated pivot and filter settings from the ZIP.

## MCP and other engines

Use `rig-hierarchy` for the art revision and `timeline-summary` for the selected clip revision. Call `export_sprite_package` with the clip ID, both revisions, and a zero-based inclusive range. Optional settings include `pivot`, `loop` and `filter`. Set `preflight: true` to inspect the manifest without rendering. For a download, decode `structuredContent.base64` and save the returned filename.

Other importers can read `kinetix.json`, verify the atlas digest and read each rectangle from `atlas.png`. Use `durationTicks / clip.fps` for frame duration and place the art relative to its pivot. When using linear filtering, clamp texture sampling to the frame rectangle. This profile represents one clip. For multi-clip exports and packed atlases, use the version 2 bundle.
