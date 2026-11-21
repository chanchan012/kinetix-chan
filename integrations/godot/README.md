# Kinetix sprite importer for Godot

Copy the three `.gd` files into the same folder in a Godot 4.5.1 project. In Kinetix, export a **Portable sprite bundle (ZIP)**. For a project with the scripts under `res://tools/`, run the following command with the Godot executable, project folder and downloaded ZIP.

```text
godot --headless --path <game-project> --script res://tools/import_sprite_package.gd -- <downloaded-zip>
```

The `KINETIX_IMPORT` JSON receipt lists the multi-clip `sprite.tscn` and `frames.res`, stable clip keys, and generated single-clip scenes. Instance a generated scene under a game-owned parent and keep placement and gameplay logic on that parent. The aggregate holds the clips from the latest bundle. An omitted clip is listed in the receipt and its single-clip scene remains available. Import the same saved project and clip IDs to update playable resources at the same paths. Generated textures are shared across scenes and keyed by pixel content.

Call `play_kinetix_clip(clip_id)` on the generated node, or call Godot's `play()` with a receipt key. Connect `kinetix_event(clip_id, frame_id, cue, data)` for typed frame cues during forward playback, including the return leg of authored ping-pong clips. Pause before scrubbing frames. Use `kinetix_socket_transform(name)` for a transform relative to the sprite node and `kinetix_frame_data()` for the current pivots, collisions, sockets and timing in source pixels. The node scale converts exported pixels back to artboard units. Attach a prop or enable collision geometry in game code to suit the game's physics and coordinate setup.

The importer also reads the version 1 fixed-grid profile. A later version 2 import with the same IDs preserves existing single-clip scene paths and animation keys. Keep game-owned files outside `kinetix_generated` and close the editor or wait for its refresh after importing. See the [sprite package contract](https://github.com/chanchan012/kinetix-chan/blob/main/docs/ENGINE_EXPORT.md) for frame and texture semantics.

If the process was forcibly stopped, confirm no importer is running before removing the empty `.kinetix-import.lock` directory inside the rig's generated directory. Rerun the import with the same ZIP to restore the complete set of generated files.
