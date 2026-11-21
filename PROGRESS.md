# Kinetix progress

## Completed · Subgoal 1.1 foundation

Implemented the application shell, interactive guest playground, Clerk access routes, Hono RPC, request throttling and the initial Neon/Drizzle migration. Strict type checking, 9 Vitest cases and 20 Playwright checks pass.

## Release verification · November 18, 2026

| Stage | Evidence |
| --- | --- |
| Brief and build | Scoped to the foundation, guest and authenticated service boundaries, and responsive shell. |
| Test | Strict TypeScript, 9 Vitest and 20 Playwright checks passed. Desktop and mobile screenshots were visually reviewed. |
| Merge | Feature commit `2d5e23a` merged into `main` at `ab166b1`. Both branches were pushed to [GitHub](https://github.com/chanchan012/kinetix-chan). |
| Deploy | Local Next.js 16.4.6 production build passed. Vercel reported READY for the [feature preview](https://kinetix-chan-142em68el-chanchans-projects-aada625f.vercel.app) and [production](https://kinetix-chan.vercel.app). |
| Document | Architecture and resume handoff include schema, API, environment setup, test commands and live-service caveats. |

## Active subgoal and next exact step

The active implementation goal covers all 23 subgoals in [the production studio roadmap](docs/PRODUCTION_STUDIO_ROADMAP.md). Deployed work includes the original M5.1 through M5.5 slices, part position channels from M7.1, portable sprite bundles from M9.1 and Godot sprite import from M9.3. M8.1 has shipped editable SVG, PNG sequence and sprite atlas import, editable project archives and reusable PNG and WebP images with relinking. The [production tool inventory](docs/PRODUCTION_STUDIO_ROADMAP.md#production-tool-inventory) maps the illustrator and MCP toolsets to their subgoals. The [delivery paths](docs/PRODUCTION_STUDIO_ROADMAP.md#choose-a-delivery-path) cover basic grid slicers, portable players, native engine importers, runtime rigs and media pipelines.

The Phaser 3.90.0 profile is on GitHub `main` and in a ready Vercel preview. Vercel rejected the production build with a 24-hour deployment rate limit on November 21, 2026 at 12:13 UTC. Start the independent PixiJS slice from the version 2 fixture. After the limit clears, deploy the validated `main` revision to production and verify the Phaser ZIP and signed-in Studio player workflow.

Unity remains at feature commit `e71ae3e`. Windows canceled the official editor installer launch. Run the Unity 6000.3.29f1 editor check described in the [resume handoff](docs/RESUME_HANDOFF.md#m93--next-implementation-step) before releasing that adapter.

Owner-managed Inngest Cloud activation is still open. After the signing and event keys are present in Vercel, redeploy, sync the existing endpoint, and verify a hosted thumbnail and animation export run. Saved still PNGs are served directly.

## M9.3 Phaser sprite profile · November 21, 2026

- **Brief and build** added the Phaser 3.90.0 sprite library, starter scene and ZIP for loose frames, fixed grids and packed atlases. Clips can be updated by stable ID and a failed update keeps the existing actor playable.
- **Test** passed strict TypeScript, 91 Vitest checks including Godot, and 98 authenticated Playwright cases across four viewports with six expected skips. Three Phaser checks covered Canvas, WebGL, reimport and the starter. The downloaded project also built and played a cue in a clean install.
- **Merge** published `0f92d7a` on `codex/m9-3-phaser-sprites` and merged it to `main` at `79ffea0`.
- **Deploy** passed the local Next.js production build. Vercel marked the feature preview ready. An authenticated preview request verified the Phaser link and the `application/zip` download. Production awaits the rate-limit reset. [Feature preview](https://kinetix-chan-l26n5z98k-chanchans-projects-aada625f.vercel.app/sprite-player) · [GitHub release commit](https://github.com/chanchan012/kinetix-chan/commit/79ffea0e2c8580a62ec97eee4cfed1f840acc037)
- **Document** records the import API, recovery behavior and production verification in the [engine export guide](docs/ENGINE_EXPORT.md#import-and-update-in-phaser-3900) and [resume handoff](docs/RESUME_HANDOFF.md#m93--phaser-verification).

## M8.1 reusable image assets · November 21, 2026

- **Brief and build** added a searchable image catalog, reference and artwork placements, bone attachments, scoped MCP image tools and project ZIP relinking. Multiple placements share one source image and update together.
- **Test** passed strict TypeScript, 90 Vitest checks with Godot enabled, and 98 Playwright cases across four viewport profiles with six expected skips.
- **Merge** published feature commit `9c2cc54` and main merge `4e2858a`.
- **Deploy** passed the local production build and verified Vercel [preview](https://kinetix-chan-68x5hn186-chanchans-projects-aada625f.vercel.app) and [production](https://kinetix-chan.vercel.app). Desktop and mobile signed-in smoke tests passed, including clean-account relinking and scoped MCP replacement on desktop.
- **Document** records the image catalog, archive version 2, supported render profiles and the Unity adapter fixture. The release requires no database migration or new service values.

## M8.1 editable project archives · November 21, 2026

- **Brief and build** added a versioned editable project ZIP, snapshot-pinned export, integrity-checked reopen, remapped clip links and atomic creation of the receiving user's private copy. A separate opt-in permission grants MCP archive reopening.
- **Test** passed the Next.js production build, strict TypeScript, and 87 Vitest checks with Godot enabled. The full Playwright matrix passed 94 cases with six expected skips. The desktop fixture verified independent accounts, linked and blank cels, original and restored artwork, and scoped MCP.
- **Merge** published feature commit `234173a` and main merge `c9acfb7`.
- **Deploy** applied the tracked additive Neon migration and verified Vercel [preview](https://kinetix-chan-aqhvokdkj-chanchans-projects-aada625f.vercel.app) and [production](https://kinetix-chan.vercel.app). Two signed-in production smoke tests passed on desktop and portrait mobile.
- **Document** records the package format, account and MCP boundaries, service configuration and the image reference dependency fixture.

## M8.1 portable sprite atlas import · November 21, 2026

- **Brief and build** added editable cels and clip creation from all three version 2 sprite layouts. Studio, REST and scoped MCP share the importer. Preserved export carries source holds, directions, loop modes, anchors and companion data.
- **Test** passed strict TypeScript and 83 Vitest cases with Godot enabled. Across the full Playwright run and reruns, all 90 distinct executable cases passed with six expected skips. The reruns verified the corrected badge state polling and compared atlas clips by direction.
- **Merge** published feature commit `68433c0` and main merge `1227f8e`.
- **Deploy** passed the local production build and verified Vercel [preview](https://kinetix-chan-aashdwq5e-chanchans-projects-aada625f.vercel.app) and [production](https://kinetix-chan.vercel.app). Desktop and mobile production smoke tests imported and re-exported the packed fixture. Desktop also verified import and export through scoped MCP.
- **Document** records the archive and export contracts, limits and the next portable project fixture.

## M8.1 PNG sequence import · November 21, 2026

- **Brief and build** added **Layers → Import PNG sequence** and scoped MCP `import_png_sequence` for exported ZIPs and consecutive numbered PNGs. The importer preserves the timebase, visible pixels and blank frames. It creates an editable RGBA drawing and its clip in a revision-checked PostgreSQL statement.
- **Test** passed 79 Vitest checks, including engine fixtures, sequence pixel and timing round trips, concurrent imports and rollback. Playwright passed 86 checks on four viewports with six expected desktop-only skips. The browser edited a held cel, reopened the project and verified that Studio and MCP produce the same re-exported frames.
- **Merge** published `dcae0b4` on `codex/m8-1-png-sequences` and merged it as `4f76872` on `main`.
- **Deploy** passed the local Next.js Webpack build. Vercel marked the [feature preview](https://kinetix-chan-bc060yd3c-chanchans-projects-aada625f.vercel.app) and [production](https://kinetix-chan.vercel.app) ready. Two authenticated production smoke checks passed on desktop and phone portrait.
- **Document** records file limits, the MCP contract, the new saved clip behavior and the packed atlas continuation in [the resume handoff](docs/RESUME_HANDOFF.md#m81--png-sequence-import). The release needs no new environment variables or database migrations.

## M8.1 editable SVG import · November 21, 2026

- **Brief and build** added editable SVG import under Studio Layers and scoped MCP `import_svg`. Imports preserve layered Bézier geometry, compound fill rules, solid paint, linear gradient alpha and vector clips. Studio shows a rendered preflight and applies the import in one undoable batch. The release also contains positioned Studio controls within the mobile shell.
- **Test** passed 74 Vitest checks including Godot, with 82 Playwright checks passed on four viewport profiles and six expected desktop-only skips. The SVG fixture compared exported pixels with an independent renderer. The authenticated browser test edited the imported paths, reopened the project and verified byte-identical PNGs from Studio and MCP.
- **Merge** published `7e9a3f5` on `codex/m8-1-svg-exchange` and merged it as `677fac7` on `main`.
- **Deploy** passed the local Next.js Webpack build. Vercel marked the [feature preview](https://kinetix-chan-71wourhs2-chanchans-projects-aada625f.vercel.app) and [production](https://kinetix-chan.vercel.app) ready. All six authenticated production checks passed across desktop and mobile. They covered editable SVG import, export queueing and viewport containment during editing.
- **Document** records the SVG capabilities, API contract, limits and exact PNG sequence continuation in [the resume handoff](docs/RESUME_HANDOFF.md#m81--editable-svg-import). No new environment variables or database migrations are required.

## M9.3 Godot sprite adapter · November 21, 2026

- **Brief and build** extended the Godot 4.5.1 importer to all version 2 layouts. It generates aggregate and per-clip scenes, preserves clip keys on reimport, and exposes frame-specific anchors, sockets, collision metadata and cue signals. The sprite player offers a public installer ZIP.
- **Test** passed 69 Vitest checks, including version 1 and version 2 in a clean Godot project, and 78 Playwright checks across four viewports with six expected desktop-only skips. The native fixture covered rotated and trimmed pixels, linear premultiplied textures, unequal holds, blank frames, all loop modes, migrated game references, renamed and omitted clips, concurrent import rejection and corrupt data rejection.
- **Merge** published `9d987de` on `codex/m9-3-godot-bundles` and merged it as `09e8b5d` on `main`.
- **Deploy** passed the local Webpack production build. Vercel marked the [feature preview](https://kinetix-chan-4mtan7num-chanchans-projects-aada625f.vercel.app) and [production](https://kinetix-chan.vercel.app) ready. The signed-in production mobile smoke exported and played all three layouts and downloaded the importer. The public ZIP's four files matched the released Git files byte-for-byte.
- **Document** records the installation, runtime API and reimport behavior in [the sprite package contract](docs/ENGINE_EXPORT.md#import-and-update-in-godot-451). No database, environment or MCP schema changes are required.

## M9.1 portable sprite delivery · November 21, 2026

- **Brief and build** added version 2 loose PNGs, fixed grids and packed atlas pages with revision-pinned clips, directions, variable holds, texture settings and frame metadata. The reference player validates PNG digests and restores trimmed and rotated frames. A published JSON Schema describes the bundle fields.
- **Test** passed 68 Vitest cases with the existing Godot integration enabled and 78 Playwright cases, with six expected skips. The browser compared all three layouts at 1.25×, including a transparent blank. A six-pose fixture covered packed page limits and pivot scaling at 1× and 3×. An additional geometry check verified 500 deterministic atlases for page bounds and gutter separation.
- **Merge** published feature commit `21b45f4` and merged it as `9eaacda` on `main`.
- **Deploy** the local Webpack build and Vercel Turbopack build passed. The [feature preview](https://kinetix-chan-gxobvl56g-chanchans-projects-aada625f.vercel.app) and [production](https://kinetix-chan.vercel.app) are ready. The hosted smoke clicked the phone preflight control, compared byte-identical REST and MCP ZIPs, and loaded rotated and blank frames in the player. The test account and rig were removed.
- **Document** records the version 2 contract. At the M9.1 release, the Godot adapter was verified for version 1 fixed grids. The later M9.3 slice added version 2 support.

## M5.5 drawn cels and pixel art · November 21, 2026

- **Brief and build** added indexed and RGBA drawing layers, pressure-aware brush tools, palette ramps, pixel-region transforms, a cel exposure lane, configurable onion colors, and integer-scale raster delivery. Studio and MCP share the pixel operations and exposure sampler.
- **Test** passed 64 Vitest checks, with the six-pose fixture playing and reimporting at 1× and 3× in Godot 4.5.1. The full Playwright run and corrected guide-snapping rerun cover 74 passing cases across four layouts, with six expected desktop-only skips. The worker test rendered the original indexed colors after the saved palette changed.
- **Merge** published `868a1fe` on the feature branch and merged it at `94c97fd` on `main`.
- **Deploy** the local Next.js production build passed using Webpack. Vercel's default Turbopack build passed on the [feature preview](https://kinetix-chan-bv2447ee8-chanchans-projects-aada625f.vercel.app) and [production](https://kinetix-chan.vercel.app). A hosted test authored cels through MCP, opened the exposure lane on a phone viewport, and verified byte-identical 3× ZIPs from MCP and the Studio endpoint. The temporary rig and account were removed.
- **Document** records cel storage, command and export contracts, and the portable sprite package handoff.

## M5.4 layers and appearance · November 21, 2026

- **Brief and build** added nested layers, linked swatches, linear gradients, editable strokes, opacity, masks, compound paths and Boolean operations. Studio and MCP use the same revision-checked document commands.
- **Test** passed 57 Vitest cases with Godot enabled and 70 Playwright cases across four layouts, with six expected desktop-only skips. The badge fixture checked two linked fills after recolor and undo, a transparent cutout, and a clipped gradient in the downloaded PNG. Lottie-web 5.13.0 independently played the exported badge with SVG and Canvas and matched the sampled color and alpha.
- **Merge** published feature commit `70e6c62` and merged it to `main` at `6a88a2b`.
- **Deploy** the local Webpack production build passed after a Windows Turbopack CSS-worker startup error. Vercel's default Turbopack build passed on the [feature preview](https://kinetix-chan-k7yfj70ev-chanchans-projects-aada625f.vercel.app) and [production](https://kinetix-chan.vercel.app). A hosted smoke test created the badge through scoped MCP, inspected it on a phone viewport and checked exported pixels. The test rig and account were removed.
- **Document** records schema, commands, render limits and the exact M5.5 starting step.

## M5.3 faceted artwork · November 20, 2026

- **Brief and build** added shared face vertices and edges, editable colors, face drafting, weld, cut, mirror, triangulation preview, and independent deformation subdivision. The same edit commands are available through MCP.
- **Test** passed 46 Vitest tests with Godot enabled and 62 Playwright cases across four layouts, with six expected desktop-only skips. Tests moved a three-color junction, measured alpha at shared edges, and confirmed a weighted subdivision preserved the posed outline and colors.
- **Merge** published feature commit `8c5b1f0` and main merge `b74570a`.
- **Deploy** passed the local production build. Vercel preview and production are ready. The hosted smoke moved a shared junction through MCP, split its bound mesh, opened the facet inspector on a phone-sized viewport, and verified the exported PNG colors.
- **Document** records the graph, editor tools, and layer-tree implementation handoff.

## M5.2 precision editing · November 20, 2026

- **Brief and build** added path transforms with editable pivots, multi-path selection and layout, rulers and guides, snapping with an Alt override, primitives, smoothing, and path editing commands shared with MCP.
- **Test** passed 42 Vitest tests with Godot enabled and 58 Playwright cases across the regression run and targeted reruns, with six expected desktop-only skips. The browser fixtures covered transformed pointer and keyboard edits, marquee and lasso, alignment, distribution, and guide snapping.
- **Merge** published feature commit `ee54bd2` and main merge `eab7804`.
- **Deploy** passed the local production build. Vercel preview and production are ready. The hosted smoke created two primitives through MCP, aligned them, saved a guide, and downloaded the resulting PNG.
- **Document** records the transform and authoring contracts and the next facet-graph step.

## First playable asset · November 20, 2026

- **Brief and build** added editable part X/Y animation channels, the revision-bound fixed-grid sprite ZIP, and the Godot 4.5.1 importer. The studio and MCP use the same animation sampler and exporter.
- **Test** passed strict TypeScript, 37 Vitest tests with the Godot integration enabled, and 50 Playwright checks across four viewports, with six expected desktop-only skips. Godot played the imported animation, checked frame pixels and pivot, then retained a game-authored wrapper scene through a renamed and revised reimport.
- **Merge** published feature commit `ff25f71` and main merge `d471edc`.
- **Deploy** passed the local production build. Vercel preview and production are ready. The hosted smoke created a polygon and clip through MCP, validated preflight, matched browser and agent ZIP bytes, and opened Export on a phone-sized viewport.
- **Document** records the package, the importer command, and the exact next precision-editing step.

## M5.1 release · November 20, 2026

- **Brief and build** added a versioned blank design with named custom artboards, polygon drawing, vertex drags, edge insertion, fills, stacking, and saved still PNGs. MCP reads artboard bounds and accepts revision-checked document commands.
- **Test** passed strict TypeScript, 35 Vitest tests and 46 Playwright checks across four viewports. Six desktop-only combinations were skipped as intended. The new check drew and edited three parts, undid a vertex move, reopened the saved design and downloaded a 240 × 360 RGBA PNG.
- **Merge** published feature commit `161f04e` and main merge `15f8ec1`.
- **Deploy** passed the local production build, Vercel preview and production. A signed-in phone browser created a 96 × 151 design, observed an MCP polygon and edge split in the open studio, and downloaded a matching RGBA PNG. The temporary fixtures were removed.
- **Document** records the format, authenticated PNG route, MCP commands, verification commands and next implementation step.

## Workspace UI follow-up · November 20, 2026

- **Brief and build** moved motion studies into a dashboard dialog, linked rig cards directly to the studio, and placed owner actions in a card menu. The studio now manages clips in the timeline and adds floating controls, resizable panels, header presence, and keyboard shortcuts.
- **Test** passed strict TypeScript, 33 Vitest tests, and 42 Playwright checks across the full run and corrected clip-management rerun. The two desktop-only integration checks were skipped on the other three profiles.
- **Merge** published feature commit `34f1c3e` and main merge `bc8ad0c` to [GitHub](https://github.com/chanchan012/kinetix-chan).
- **Deploy** passed the local Next.js production build. Vercel marked the [feature preview](https://kinetix-chan-c1uupx8fa-chanchans-projects-aada625f.vercel.app) and [production](https://kinetix-chan.vercel.app) ready. A signed-in phone-sized browser verified the studies dialog, direct rig navigation, header presence, timeline resize handle, keyboard guide, clip creation, and viewport fit. Temporary fixtures were removed.
- **Document** records the dashboard and studio behavior, focused regression command, and remaining Inngest activation.

## Subgoal 4.2 release · November 20, 2026

- **Brief and build** added a Hono MCP v2 endpoint, stdio bridge, and studio setup dialog. The server exposes ten tools and three resources. Owners create revocable rig credentials. Agent edits and clips appear in the studio through the live room.
- **Test** passed strict TypeScript, 33 Vitest tests and 42 Playwright checks across four viewport profiles. Six runs of the two desktop-only integration tests were intentionally skipped. The agent test built and skinned a leg, generated a walk cycle, baked IK, verified stdio, denied cross-rig access and revoked its credential. The browser suite runs serially against the shared Upstash bucket.
- **Merge** published feature commit `b38ed40` and main merge `3610783` to GitHub.
- **Deploy** applied `0005_rig_tokens.sql` and passed the production build. Vercel marked the [feature preview](https://kinetix-chan-a4o3jmike-chanchans-projects-aada625f.vercel.app) and [production](https://kinetix-chan.vercel.app) ready. The live smoke check discovered the catalogue, read current hierarchy and timeline data, observed agent edits in the open studio, and verified that revocation returns 401.
- **Document** records the transport configuration, supported operations, verification commands and remaining Inngest activation.

## Subgoal 4.1 release · November 20, 2026

- **Brief and build** added private editor sharing, scoped SSE rooms, live selections, and revision-checked Neon autosave. The room protocol accepts human and AI actors.
- **Test** passed strict TypeScript, 32 Vitest tests and 41 Playwright checks. The desktop-only two-account test was skipped on the other three profiles. It verified access grants and revocation, live selections, autosave, and the latest revision on a fresh stream.
- **Merge** published feature commit `1928146` and main merge `37566ec` to GitHub.
- **Deploy** applied `0004_rig_collaborators.sql` and passed the production build. Vercel marked the [feature preview](https://kinetix-chan-arvkmdbm3-chanchans-projects-aada625f.vercel.app) and [production](https://kinetix-chan.vercel.app) ready. Two production sessions confirmed selection delivery and autosaved rotations.
- **Document** records room permissions, recovery behavior and the MCP integration point.

## Subgoal 3.2 release · November 20, 2026

- **Brief and build** added owner-scoped snapshots, an Inngest render queue and a studio export dialog for Lottie, PNG sequence, spritesheet, MP4 and WebM.
- **Test** passed strict TypeScript, 30 Vitest tests and 40 Playwright cases with a local Inngest Dev Server. Four focused browser cases produced and downloaded all five formats. Tests cover immutable inputs, lease recovery, download ownership and artifact signatures.
- **Merge** published feature commit `be2f29e` and main merge `8de7f3e` to GitHub.
- **Deploy** applied migration `0003_export_jobs.sql` to Neon. The local production build passed and its Inngest function trace included FFmpeg. Vercel marked the [feature preview](https://kinetix-chan-gx58ofwx7-chanchans-projects-aada625f.vercel.app) and [production](https://kinetix-chan.vercel.app) ready. Production queued a Lottie job from the studio. The test rig and queued job were removed. Hosted rendering is pending the owner-managed keys and endpoint sync.
- **Document** records the export lifecycle, limits and local worker test commands.

## Subgoal 3.1 release · November 20, 2026

- **Brief and build** added typed clip tracks, playback sampling, a dope sheet and cubic Bézier editor, onion skins, mesh binding and weight painting. The track endpoint validates keys and checks the clip revision.
- **Test** passed strict TypeScript, 25 Vitest tests and 36 authenticated Playwright cases. Four viewport profiles verified keyframe writes, easing, onion skins, mesh binding, weight painting and studio fit.
- **Merge** published feature commit `91d97bf` and main merge `7587df8` to GitHub.
- **Deploy** applied the additive clip revision migration to Neon and passed the local production build. Vercel marked the [feature preview](https://kinetix-chan-a7o0i3ksk-chanchans-projects-aada625f.vercel.app) and [production](https://kinetix-chan.vercel.app) ready. The live studio saved and read back a keyframe at revision 1. Temporary fixtures were removed.
- **Document** records the keyframe convention, graph and mesh UI, migration and export integration points.

## Subgoal 2.2 release · November 20, 2026

- **Brief and build** added the owner-protected saved-rig studio, hierarchy, inspector, canvas bone and Bézier tools, playback timeline, and manual revision-checked saves.
- **Test** passed strict TypeScript, 20 Vitest tests and 32 authenticated Playwright cases. Studio checks cover rotation, undo and redo, child-bone snapping, Bézier handles, saves and viewport fit on four profiles. Desktop and phone screenshots were reviewed.
- **Merge** published feature commit `05e3bcd` and main merge `2c38174` to GitHub.
- **Deploy** passed the local production build. Vercel marked the [feature preview](https://kinetix-chan-phrlufdkg-chanchans-projects-aada625f.vercel.app) and [production](https://kinetix-chan.vercel.app) ready. Chrome at a phone viewport loaded a saved rig, edited a rotation, and confirmed persistence by reading its state. The temporary account and rig were removed.
- **Document** records the renderer, vector data, studio controls and 3.1 integration points.

## Subgoal 2.1 release · November 20, 2026

- **Brief and build** added deterministic rig documents, hierarchical forward kinematics, two-bone IK, and an attributed Zustand/Immer command history with undo and redo. The owner API accepts revision-checked saves and supports existing study-only records.
- **Test** passed strict TypeScript, 20 Vitest tests and 32 authenticated Playwright cases across the four viewport profiles.
- **Merge** published feature commit `78859f3` and main merge `ec5f1e0` to GitHub.
- **Deploy** passed the local production build. Vercel marked the [feature preview](https://kinetix-chan-rkmrpi7rx-chanchans-projects-aada625f.vercel.app) and [production](https://kinetix-chan.vercel.app) ready. The live check created a rig, loaded version 1, saved a rotation and received a 409 on a stale retry. The temporary rig and account were removed.
- **Document** records the rig format, save contract and viewport integration entry point.

## Authenticated workspace release · November 19, 2026

- **Brief and build** moved interactive studies behind Clerk, removed guest entry and the demo override, and kept the landing and account forms public. Dashboard and studio pages enforce sessions on the server. Private Hono endpoints require verified identity. Auth forms resize within the viewport and scroll internally on short screens.
- **Test** passed strict TypeScript, all 10 Vitest tests and all 28 Playwright cases across four viewport profiles with real Clerk development sessions.
- **Merge** published feature commit `8d4b807` and main merge `d95bc56` to GitHub.
- **Deploy** passed the local production build. Vercel marked the [feature preview](https://kinetix-chan-ngnqx9sk6-chanchans-projects-aada625f.vercel.app) and [production](https://kinetix-chan.vercel.app) ready. Chrome at a phone viewport verified a sign-in redirect, 401s for signed-out API requests, a member session matching the temporary user, the Neon-backed library, and protected study playback. The temporary account was removed.
- **Document** updated the current route contracts, Vercel scopes, test setup and next development step. Earlier release notes below describe the behavior at the time of those releases.

## Subgoal 1.2 release · November 19, 2026

- **Brief and build** covered the dashboard library, Hono rig and clip CRUD, owner isolation and durable thumbnail generation. Guests open the three sample studies. Members manage their own records.
- **Test** passed strict TypeScript, 11 Vitest tests and 28 Playwright checks. A live Neon fixture verified owner isolation, clip insertion and PNG persistence and was removed afterward. The SDK advertised one function in local development mode.
- **Merge and deploy** published feature commit `1f81d5c` and main merge `3b56e10`. The production build passed and both Vercel deployments reached READY. [Signed-in preview](https://kinetix-chan-git-feature-12-cac1a9-chanchans-projects-aada625f.vercel.app/dashboard) · [Guest dashboard](https://kinetix-chan.vercel.app/dashboard)
- **Document** recorded the additional SQL column, API contracts, preview database scope, SDK setup and pending cloud verification.

## Service configuration · November 19, 2026

- Created the `kinetix` database in Neon project `still-bird-86777802` and applied the foundation migration. Verified the `rigs`, `clips` and Drizzle migration tables.
- Reused the existing `kinora` Free Tier Redis database. The configured credentials returned PONG.
- Created a dedicated Clerk application named Kinetix. Its development instance is configured locally and on the [Vercel preview](https://kinetix-chan-git-feature-11-4f5f92-chanchans-projects-aada625f.vercel.app).
- Vercel Production has the pooled Neon URL and the Redis credentials. It serves guest access until a custom domain is linked and the Clerk production instance is configured.
