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

The active implementation goal covers all 23 subgoals in [the production studio roadmap](docs/PRODUCTION_STUDIO_ROADMAP.md). M5.1 through M5.4 and the first playable asset workflow are deployed. The first playable asset workflow delivers part position channels from 7.1, fixed-grid packages from 9.1, and the Godot sprite adapter from 9.3. Those three subgoals have further acceptance criteria in the roadmap.

M5.5 is next. Add stable drawing and cel IDs, a versioned raster drawing format and frame exposure records that reference cels. Verify held exposures and linked versus independent copies through the shared command model before wiring pressure drawing, onion skins and sprite exports.

Owner-managed Inngest Cloud activation is still open. After the signing and event keys are present in Vercel, redeploy, sync the existing endpoint, and verify a hosted thumbnail and animation export run. Saved still PNGs are served directly.

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
