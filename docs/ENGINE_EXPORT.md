# Sprite packages in Godot

The first engine handoff targets Godot 4.5.1. The ZIP also exposes everything a custom importer needs to play a single fixed-grid clip.

## Export from Kinetix

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

Other importers can read `kinetix.json`, verify the atlas digest and read each rectangle from `atlas.png`. Use `durationTicks / clip.fps` for frame duration and place the art relative to its pivot. When using linear filtering, clamp texture sampling to the frame rectangle. This package represents one clip. The roadmap covers packed atlases, variable frame timing, runtime rigs and additional engine adapters.
