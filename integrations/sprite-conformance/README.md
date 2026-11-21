# Kinetix sprite conformance kit

The samples represent one 16 × 16 animation with two directions, a blank cel, unequal holds, a rotated crop, a shifted pivot, and events on a ping-pong loop. The exact portable source and the fixed-rate ZIPs come from the same saved revision.

1. Extract this kit. With Node.js 24 installed, run `npm ci`, then `npm run verify` from the kit root.
2. Extract `examples/grid-24.zip` and import a clip folder's sheets in filename order. Slice 16 × 16 cells from the top left, left to right and then top to bottom. Play one cell per frame at 24 FPS. Ignore padded cells after the clip's last frame.
3. Repeat with `examples/frames-24.zip`. Import each clip folder's numbered images as an image sequence at 24 FPS. East plays once for 214 frames. West repeats a 24-frame cycle with its reverse interior poses already included.
4. Compare the output with the known frame runs and cue positions in `examples/expected.json`. Load your own game asset with `npm run inspect -- path/to/export.zip` to validate its inventory, image digests and timing and print the manifest.

The fixed-rate profile uses straight-alpha sRGB PNGs with a consistent artboard size. `timing.json` describes the source timeline, output frame runs, clip page counts and cue placement at the requested FPS. The original loop mode is recorded for reference. For playback, repeat fixed images for both repeat and ping-pong clips. Run a once clip once and keep its final frame if your engine supports holding it.

For an exact variable-rate implementation, load `examples/source-v2.zip`. The included TypeScript reference decoder validates texture bounds and hashes, restores a rotated crop, maps source ticks and reports cue positions. `schemas` contains the JSON Schemas for both profiles. Use the loaders to check cross-field rules such as contiguous frame holds and file coverage. `verify` compares both kinds of plain PNG output with the exact portable source and rejects a damaged ZIP.
