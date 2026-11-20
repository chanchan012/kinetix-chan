# Kinetix production studio roadmap

## Product direction

Kinetix should let an illustrator draw a faceted character from a blank artboard, hand it to a rigger, animate it in several shots, review a proposed change from an AI editor, and deliver both editable artwork and rendered animation. A motion designer should be able to use the same document, layers, and timeline to animate a wordmark without creating a skeleton.

This is a proposed M5–M9 roadmap. Success has two concrete measures. An illustrator and an authorized agent can each take a blank project through final delivery. A game developer can import an approved animation into a supported engine, play it, revise the source, and reimport while preserving scene references and game-specific settings.

The existing studio already provides Bézier paths, bone hierarchies, two-bone IK, mesh weights, animation clips, a dope sheet, curve editing, onion skinning, shared editing, MCP, and five export formats. The current rig document requires a fox, heron, or fish study. The export renderer uses a 512 × 320 artboard. The hosted Inngest render still needs verification after the owner configures the keys. Engine packages, importers, and the expanded authoring tools below are proposed work.

## M5 · Draw original artwork

| Subgoal | Artist tools and behavior | Acceptance |
| --- | --- | --- |
| 5.1 Documents and polygon drawing | New blank design, named artboard, custom dimensions and background, polygon pen, direct vertex selection, edge insertion, solid fills, object naming and stacking order. Preserve existing study documents with a versioned reader. | Draw a three-part fox head on a transparent portrait artboard. Move one vertex, undo, reopen and export a PNG at the document dimensions. An older fox rig still renders at its original framing. |
| 5.2 Precision and path editing | Selection and direct selection, marquee and lasso, move, rotate, scale, flip, numerical transforms, editable pivot, rulers, guides, snapping, align and distribute. Add rectangle, ellipse, star, pencil smoothing, corner and smooth nodes, adjustable Bézier handles, cut, join, reverse and simplify path. | Reproduce a dimensioned logo. Keyboard nudges, numerical entry and pointer edits agree at different zoom levels. A user can temporarily override snapping while dragging. |
| 5.3 Faceted artwork | Face, edge and vertex modes, connected faces, cut face, weld vertices, split edge, mirror, per-face fill and eyedropper. Show a preview for automatic triangulation. Allow the artist to choose which faces share an edge. Keep visual facets and deformation topology independently editable. | Move the junction of three colored faces and see all three follow without a crack. Splitting a deformation triangle preserves the artwork silhouette and face colors. |
| 5.4 Layers and appearance | Group, nest, reorder, isolate, lock, hide, duplicate and search layers. Add compound paths and holes, union, subtract, intersect and exclude, stroke caps and joins, dashes, gradients, opacity, reusable swatches and clipping masks. | Create a badge with a cutout, clipped highlights and linked palette colors. Recolor it once, undo the change and verify the transparent export. |
| 5.5 Drawn cels and pixel art | Pencil, pressure brush, eraser, fill, selections, transform selection, indexed palettes, pixel grid and nearest-neighbor preview. Create, duplicate, link or unlink cels, flip between drawings, and use colored onion skins. Mix cel artwork and vectors on separate layers. | Draw a six-pose lantern flame by hand. Reuse a held cel, edit one independent copy, then export at 1× and 3× with identical timing and crisp pixels. |

## M6 · Rig, deform and reuse characters

| Subgoal | Artist tools and behavior | Acceptance |
| --- | --- | --- |
| 6.1 Skeleton setup | Distinct setup and pose modes, draw joint chains, reparent while preserving world pose, name and mirror limbs, joint limits, pole controls, FK/IK switching, reset to bind pose and selectable controller shapes. | An animator switches a planted foot between IK and FK at the current frame without a visible pose jump. A rest-pose edit identifies the clips it affects. |
| 6.2 Mesh workshop | Editable triangulation, add and pin vertices, flip an edge, automatic bind with preview, influence heatmap, weight brush with add, subtract, smooth and normalize, locked influences, mirrored weights and side-by-side rest/posed views. | Repair a collapsing elbow while viewing the bent pose. Locked influences retain their weights and each vertex stays normalized. Undo the whole brush stroke once. |
| 6.3 Character assets | Named slots, swappable attachments, draw order, pose and expression libraries, reusable characters, instance overrides and relinking. Preview rig-version changes against existing clips. | Two shots use the same character with different mouths and props. Updating a shared hand preserves each shot’s prop, animation and approved rig version. |
| 6.4 Game animation data | Editable origins, sockets for props and effects, animated collision shapes, frame events with typed payloads, direction tags and root-motion tracks. Preview a clip in place or with authored displacement. | Attach a lantern to a named hand socket, mark footfalls, and draw a changing interaction area. Scrubbing shows the correct geometry and playing the loop fires one event for each intended footfall. |

## M7 · Animate and compose shots

| Subgoal | Artist tools and behavior | Acceptance |
| --- | --- | --- |
| 7.1 Animation editing | Key object transforms, pivots, fills, opacity and compatible paths alongside bones and IK. Add auto-key, hold/linear/Bézier interpolation, multi-key selection, duplicate, copy/paste, retime, reverse, loop ranges, markers, curve handles and a motion-path overlay. | Animate a logo with no bones. Retime a group of keys, preserve its relative timing, and verify the exported poses at the first, last and intermediate frames. |
| 7.2 Shot composition | Multiple compositions, nested instances, layer timing, clip offsets, holds and blends, camera pan/zoom, safe areas, mattes and blend modes. Add text with font fallback reporting, editable alignment and explicit conversion to outlines. | Reuse one walk cycle in two shots with different camera moves. Change a title and see both the preview and final frame use the same font metrics. |
| 7.3 Sound and drawn animation | Audio import, waveform, scrubbing, mute/solo and beat markers. Add exposure holds, drawing substitutions, an exposure sheet, reference-image sequences and mouth-shape tracks for dialogue. | Sync a footfall and a mouth change to marked audio frames. Export a video with the sound intact and a silent PNG sequence with the same visual timing. |
| 7.4 Procedural motion | Path following, trim paths, repeaters, stagger, editable parameter curves, spring/bounce controls, seeded variations and bake-to-keys. Expose inputs and resulting keys for human and agent editing. | Build a radial logo reveal, bake it, edit one instance by hand, and match the procedural result at the bake point. |
| 7.5 Storyboard to final cut | Draw storyboard panels, time an animatic against scratch audio, promote panels into shots, ripple-trim or reorder shots, and mix dialogue, music and effects with gain, fades and mute/solo. Export the sequence, individual shots or synchronized WAV stems. | Build a three-shot sequence, lengthen the middle shot and verify downstream cut points, dialogue cues, captions and the exported master against the revised animatic. |
| 7.6 Interactive playback | Preview named states, transitions, parameters, crossfades, directional sets and one-shot clips. Inspect event delivery, socket positions, root motion and the return to idle. Keep the state graph optional for linear scenes. | Trigger idle → walk → jump → idle in the studio. Compare clip order, timing and events against a small playable scene in each supported engine. |

## M8 · Review, exchange and deliver

| Subgoal | Production tools | Acceptance |
| --- | --- | --- |
| 8.1 Assets and interchange | Asset browser, folders, search, thumbnails and usage tracking. Import SVG as editable paths and PNG/WebP as references or attachments. Handle SVG viewBox, transforms, holes and gradients. Package a portable project with its linked assets and font references. | Import a layered SVG, inspect the import report, edit a path, and reopen the packaged project in a fresh workspace. Missing assets have a relink action. |
| 8.2 Review and versions | Named versions, compare and restore, frame-anchored comments, resolved threads, viewer/commenter/editor roles, expiring review links and shot approval. Bind approvals to the reviewed revision. | A reviewer annotates frame 18 without editing the scene. A later edit preserves the approved version and the original comment context. |
| 8.3 AI collaboration | Extend the existing MCP command vocabulary with the new document, selection, geometry, style, track and asset operations. Address objects by stable IDs. Support grouped edits, previewable takes, revision checks, attribution and one-step undo. | An agent proposes two timing variations on one clip. The artist previews both and accepts one. A concurrent change to that clip is surfaced before applying the take. Other layers keep their edits. |
| 8.4 Delivery | Render queue with progress, retry, cancel and job history. Choose size, frame rate, frame range, transparency and background. Add editable SVG, atlas metadata and export presets to existing Lottie, PNG, spritesheet, MP4 and WebM outputs. Report feature support before rendering, including text, masks, effects, audio and transparency. | Deliver a transparent sprite atlas with pivots, a vector logo and a 1080p review video. Re-render an approved revision after the working file changes. A failed worker resumes from a checkpoint. |

## Human and agent tool coverage

Ship the UI action and its MCP equivalent in the same authoring subgoal. Both call the same validated document commands under the caller’s project permissions. Test the same storyboard twice, once from the UI and once from a fresh MCP session. Compare the resulting geometry, pose samples, clip timing, event tracks and rendered frames. The agent must be able to inspect its work visually as well as read document state.

| Workflow | Artist interaction | Agent capability and evidence |
| --- | --- | --- |
| Inspect and plan | Browse artboards, layers, assets, shots and keys. Isolate a layer and inspect a frame. | Discover supported operations and limits. Query objects by name or stable ID, read evaluated transforms and timelines, request a frame image or contact sheet, and identify missing assets. |
| Create and revise | Draw polygons, brush strokes or cels. Edit styles, text, layer order and topology. Import authorized project assets. | Submit geometry, stroke samples, cel edits and asset references in validated batches. Preview affected bounds and a rendered diff. Replaying a retried batch must create each object only once. |
| Rig and animate | Bind a mesh, paint influences, pose limbs, key channels, time dialogue, edit cuts and preview a loop. | Inspect weights and pose errors, change bindings and keys, edit shots and cues, sample a frame range, and compare the first and last loop poses. Expose explicit time units and coordinate spaces. |
| Direct and review | Author a take, see another editor’s changes, approve a revision or restore it. | Work against a named revision, create a take, report a conflicting object, and apply or undo the accepted batch. Review and approval follow the same role rules as the UI. |
| Deliver and diagnose | Select a target, preflight it, preview baked features, export, and retrieve the package. | List target profiles, choose bake options, submit an export, poll or cancel it, retrieve artifacts, and read structured import-test results. A worker retry preserves the original snapshot. |

## M9 · Engine delivery and repeatable reimport

Offer three delivery choices in the Export dialog: **sprite animation**, **runtime rig**, and **rendered media**. Choose the engine and version next. Show the expected files, texture memory estimate and how each feature will travel. Users of an unlisted engine get a portable package, a documented loader contract and a reference player. Publish a one-step import claim only for engine versions that pass the import suite.

| Subgoal | Deliverable | Release test |
| --- | --- | --- |
| 9.1 Portable sprite package | Loose transparent PNG frames, fixed-grid sheets, or packed multi-page atlases with versioned JSON. Include per-frame duration, source size, trim offsets, pivots, clip ranges, loop mode, events and texture settings. Offer maximum texture size, padding, edge extrusion, rotation, color space, alpha convention and pixel-art filtering. Fixed-grid mode defaults to unrotated, untrimmed cells for simple slicers. | A reference player loads all three forms of one clip, including a blank frame and an asymmetric trimmed frame. At 1× and fractional display scales the pivot stays planted, holds last the right duration and adjacent sprites do not bleed. |
| 9.2 Portable rig package | Publish the schema, sample loader and fixtures for bones, bind and inverse-bind transforms, textured meshes, UVs, weights, slots, draw order, attachments, clips, curves, sockets, event tracks and root motion. Include coordinate axes, handedness, units per pixel, timebase, texture origin and stable IDs. Offer sampled bone transforms, sampled mesh deformation or sprites according to target capability. | Compare bind pose, a bent elbow, a swapped prop and a mirrored loop with frames from the studio. Check winding, UV alignment, event time and root displacement. Open a previous schema fixture with the current loader. |
| 9.3 Engine importers | Ship versioned adapters and starter scenes for the targets below. An import creates usable assets, animation names and a playable example. Store user overrides separately from generated data. Report missing, renamed or removed source objects on reimport. | In a clean project, import, play, attach a prop, change one engine-side setting, then re-export with a renamed clip and repacked atlas. Existing scene references, event bindings and documented overrides survive. |
| 9.4 Export validation and automation | Provide a target capability matrix, a project preflight, and a machine-readable import report. For every feature record native mapping, an explicit bake, a sidecar file or an incompatibility. Offer the same presets through the UI, MCP and a headless CLI for CI. Pin exporter and adapter versions in the manifest. | A mask and animated mesh sent to a sprite-only target retain their appearance through baking. Events remain readable as data. A request that requires runtime-editable bones identifies an incompatible preset before rendering. |

### Initial importer targets

| Target | First deliverable | Follow-on once validated |
| --- | --- | --- |
| Godot 4.x | Import sprites as a SpriteFrames resource with named animations and durations, and generate an AnimatedSprite2D example scene. Apply per-frame offsets when a target resource cannot express the pivot directly. | Skeleton2D, weighted Polygon2D meshes, AnimationPlayer tracks and socket nodes. |
| Unity with 2D packages | Generate Sprite sub-assets, pivots, AnimationClips and a sample prefab. Keep stable asset identities and define pixels per unit. | Map supported bones and weights to the versioned 2D Animation package. Add an optional generated Animator Controller. |
| Web with Phaser or PixiJS | Emit PNG atlases and metadata for each library’s loader. Include a runnable animation example that respects variable frame durations. | Offer the reference rig evaluator for projects that need runtime posing or attachment swaps. |
| Unreal Engine with Paper2D | Create sprites and flipbooks with scale, pivots and frame runs. Ship a playable example with an event-track sidecar reader. | Validate additional runtime rig integration separately for specific engine and plugin versions. |
| GameMaker | Import a character as sprite sequences with named clips, origins, timing and sampling settings using a versioned import script. | Add adapters for event markers and authored collision geometry. |
| Custom engines | Provide PNG sequences or sheets, JSON schemas, sample assets, a reference decoder and a minimal playback example. | Publish a conformance test kit so engine authors can validate their own importer. |

### What travels in each format

Use sprite packages for broad visual fidelity, the rig package for runtime posing and attachment swaps, SVG for editable supported vector artwork, Lottie for supported animated vector features, and PNG sequences or MP4/WebM for compositing and playback. Include separate audio stems and cue data when the destination takes sound separately. A delivery receipt names the source revision, clip and shot IDs, target version, applied bakes, companion files and their checksums. Let the artist inspect a target preview before delivery.

## Workspace and shortcuts

Use a single studio with **Design**, **Rig** and **Animate** workspaces. Keep the canvas, document and selection stable when switching. The left panel shows layers, bones or animated channels according to the active workspace. The right inspector shows properties for the selected object, face, bone or key. The timeline can collapse during drawing and expand for curves and audio. Keep presence in the header and place tool-specific options beside the floating toolbar.

Add a searchable command palette, discoverable and remappable shortcuts, numeric alternatives to dragging, visible focus, touch-friendly handles and a reduced-motion preference for interface transitions. Drawing and weight brushes should support pen pressure. At phone widths expose the canvas, active tool and timeline transport immediately, with a drawer for properties. Keep desktop, tablet, portrait phone and landscape phone in the viewport test matrix.

## Engineering and release gates

- **Document compatibility.** Give artboards, layers, faces, assets and compositions stable IDs and explicit coordinate spaces. Store source geometry, deformation data and animation tracks separately. Build fixtures for each saved document version. Test the same source in the viewport, worker and exports.
- **Safe editing and recovery.** Group a drag, brush stroke or agent proposal into one undoable command. Add local draft recovery and named server revisions. Test a closed tab during a save, two editors changing the same object, and reconnection after edits on different objects. A restored draft must identify the server revision it was based on.
- **Performance.** Establish a reference device and fixture before promising capacity. An initial desktop target is 60 fps playback at 1080p for one character with 100 bones and 5,000 mesh vertices across its parts. Record frame-time percentiles and scrub latency. Benchmark hit testing, deformation and rendering independently before moving a bottleneck to WebGL2 or a worker. Publish a separate mobile benchmark.
- **Export fidelity.** Maintain reference scenes for a cutout logo, skinned character, title with audio, and transparent sprite. Compare sampled frames and bounds between preview and each supported renderer. Evaluate vector exports in an independent viewer. Move large render artifacts into object storage and establish measured duration and resolution limits before raising existing caps.
- **Collaboration and access.** Validate document scope and permissions for every human, reviewer and agent command. Test revoked access, duplicate delivery and stale revisions. Keep named versions and immutable render inputs available for replay.
- **Release discipline.** Use BRIEF → BUILD → TEST → MERGE → DEPLOY → DOCUMENT for each subgoal. Pair Vitest checks for geometry, commands and persistence with Playwright checks for the artist workflow. Verify an authenticated hosted workflow before updating the progress, architecture and handoff documents.

## Release order

1. **First playable asset.** Pair 5.1 and basic 7.1 timing with the fixed-grid path from 9.1 and the Godot sprite importer from 9.3. Draw an original sprite, animate a loop, import it into a clean engine project and repeat the workflow through MCP. Establish revision-bound export preflight here.
2. **Illustration and sprite production.** Finish M5, add editable SVG exchange from 8.1, packed atlases and PNG sequences from 9.1, and sprite adapters for Unity and web. Ship cel timing and pixel-art import fixtures with these formats.
3. **Runtime characters.** Finish M6 and 7.1, ship named versions for shared rigs, and deliver 7.6, the 9.2 runtime contract and validated rig adapters. Use one playable character to test sockets, events, scale and reimport in each engine.
4. **Full animation production.** Finish M7 and M8. Ship storyboarding, dialogue, compositing, take review and hosted rendering. Check audio sync and alpha on delivered masters. Release advanced export presets as their hosted render and fidelity checks pass.
5. **Broader engine coverage.** Finish 9.3 and 9.4 with Unreal and GameMaker sprite importers, a custom-engine conformance kit, certified version ranges and automated reimport fixtures. Publish the coverage matrix with each release.

The first end-to-end production exercise is a ten-second shot of a faceted fox carrying a lantern. It requires connected artwork, a weighted elbow, a planted foot, a reusable prop, a camera move, synchronized audio, one reviewed agent edit, and a reproducible export. A second exercise animates a wordmark entirely with paths, type and timing to validate the motion-design workflow.

Deliver the fox again as a playable idle/walk/jump asset with a lantern socket and two timed footfalls. Run the sprite version in every certified engine and the skinned version in each certified rig adapter. Move the lantern pivot in Kinetix and reimport twice. The game scene must retain its character reference, play the revised frames, and emit the same number of footfall events. This fixture is the release gate for seamless engine handoff.
