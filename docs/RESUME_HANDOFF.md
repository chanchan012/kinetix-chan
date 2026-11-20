# Resume Kinetix

Read PROGRESS.md for release state and the next exact task. Use Node 24 and npm. Run commands from the repository root.

## Local setup

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Supply the Clerk, Upstash and Neon variables in the process environment for local integration work. This workspace already had ignored local configuration when the authentication release began.

## Service configuration

Manage deployment keys directly under the Kinetix project’s Environment Variables in Vercel. The tracked .env.example lists names only. Redeploy after changing values or target scopes.

| Variable | Purpose |
| --- | --- |
| NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY | Public key from the matching Clerk instance, required at build time for account UI |
| CLERK_SECRET_KEY | Server-only key from the same Clerk instance |
| UPSTASH_REDIS_REST_URL | Redis REST endpoint for distributed rate limiting |
| UPSTASH_REDIS_REST_TOKEN | Server-only Redis REST token |
| DATABASE_URL | Neon Postgres connection string with TLS, needed for migrations and future persistent operations |
| PLAYWRIGHT_CHANNEL | Optional browser channel; set to chrome to use installed Google Chrome |
| INNGEST_SIGNING_KEY | Inngest Cloud signing key. The owner will add this to Vercel Production. |
| INNGEST_EVENT_KEY | Owner-managed key for sending events. The 1.2 thumbnail trigger uses a cron schedule. |
| INNGEST_DEV | Set to 1 locally when working with the Inngest Dev Server. |

The initial migration has been applied to the `kinetix` database on the default branch of Neon project `still-bird-86777802`. Confirm the database and branch before running future migrations. Use the direct connection for `npm run db:migrate` and the pooled URL for Vercel. Generate future migrations with `npm run db:generate`. Redeploy Vercel after changing environment variables.

## Verification

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Playwright starts Next on localhost:3181. Use the same hostname throughout Clerk sign-in. On Windows with Chrome installed, set `$env:PLAYWRIGHT_CHANNEL='chrome'`. The suite requires network access to Clerk, Upstash and Neon. Setup checks for development-instance keys, creates a unique Clerk test user and deletes it in teardown. Session credentials stay out of browser trace artifacts.

The 1440×900, 768×1024, 375×667 and 844×390 profiles exercise landing, sign-in, sign-up, redirects with return destinations, private API rejection, authenticated dashboard and motion playback. The rig and clip editing UI test uses a real Clerk session and makes requests to the local app and configured Neon database. Vitest exercises actual SQL against embedded PostgreSQL, including ownership and thumbnail persistence.

## Known caveats

Production is https://kinetix-chan.vercel.app. Both Vercel release targets use the Kinetix Clerk development instance at the owner's request. Clerk applies development-instance limits to the live site. The dashboard and studio require sign-in on both deployments.

- The existing kinora Free Tier Redis database is shared with Kinetix. Kinetix rate-limit entries use the `kinetix:v1` prefix.
- The fixed playback studies are demo data. Saved rigs currently reference a study in their state document. The editable rig command model starts in 2.1.

## Resume after 1.2

Both SQL migrations are applied. Vercel Production uses the pooled Neon URL. The release branches `feature/1.2-dashboard` and `feature/authenticated-workspace` have branch-scoped sensitive DATABASE_URL entries for the existing `kinetix_dashboard_preview` role in the kinetix database. Configure the appropriate database scope before testing a new feature deployment.

The owner is managing the Inngest keys. After setting them, redeploy Vercel Production and sync https://kinetix-chan.vercel.app/api/inngest in Inngest Cloud. Confirm that the `kinetix-motion-studio` app lists `render-animation-thumbnails`, create a clip with **Manage clips** in the studio timeline, and verify the scheduled run stores its PNG. Before signing-key configuration the cloud endpoint returned HTTP 500. Local SDK discovery and the actual render and persistence path have passed. Hosted execution is pending.

For local background jobs, use `INNGEST_DEV=1` in .env.local, start Next, then run `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`. Unit tests use embedded PostgreSQL and real migrations. Member UI tests use mocked HTTP responses; the PostgreSQL/API suite tests actual writes and access boundaries separately.

## Resume after 2.1

The rig engine is in `lib/rig/`. Use `readRigState` when loading existing JSONB documents and `createRigStore` for per-editor commands and history. `GET /api/rigs/:id/state` returns the revision and validated document. Pass that revision back with edits and handle 409 by offering to reload the latest saved state. Subgoal 2.2 starts with the authenticated studio route and a canvas driven by `evaluateRig`.

Subgoal 2.1 adds no environment variables or SQL migrations. Its feature branch uses a scoped Neon preview variable in Vercel. Run `npm test -- tests/unit/rig.test.ts tests/unit/library.test.ts` for kinematics, history and revision conflicts. Playwright creates and removes a temporary Neon rig while exercising the signed-in state endpoint.

## Resume after 2.2

Open a saved rig by clicking its dashboard card. The route lives at `app/studio/[id]/page.tsx`. Animation sampling is integrated in `components/studio/timeline.tsx` and `components/studio/viewport.tsx`, with path drawing and transforms in `lib/rig/render.ts`. The inspector and canvas edit the same per-rig store. Click **Save** or use Ctrl/Cmd+S to persist the revision.

Subgoal 2.2 adds no environment variables or SQL migrations. The live preview uses the scoped Neon role. Browser tests cover studio pointer gestures and persistent saves, with viewport screenshots in ignored `test-results/`. Track editing, onion skinning and mesh weight painting are the next subgoal.

## Resume after 3.1

The `0002_clip_track_revision.sql` migration is applied to the Kinetix Neon database. No extra environment variables were added. Run `npm test` for interpolation, revision conflicts, mesh deformation and prior behavior. Playwright expects the new migration and tests the animated studio at all four viewport sizes. Store rig edits with **Save** and clip edits with **Save keys**.

For 3.2, reuse `lib/rig/animation.ts`, `lib/rig/kinematics.ts` and `lib/rig/render.ts` for deterministic sample frames. Export inputs should snapshot the rig and clip tracks at enqueue time. Inngest Cloud execution still depends on the owner-managed signing and event keys. Verify local render jobs separately from the hosted endpoint.

## Resume after 3.2

The export queue migration is applied to Kinetix Neon. To verify local jobs, start `npx inngest-cli@latest dev --no-discovery -u http://localhost:3181/api/inngest` in one terminal. Set `INNGEST_DEV=1` and run `npm run test:e2e -- --grep "queues an export"` in another. For full regression use `npm test` and `npm run test:e2e`. The encoder is packaged for the host platform. `FFMPEG_PATH` can override it locally.

In Vercel Production, the owner supplies `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY`. After redeploying, sync the existing `/api/inngest` endpoint in Inngest Cloud and verify that it lists `render-animation-thumbnails` and `render-animation-export`. Queue a production export and confirm the job reaches Ready and downloads successfully. Production queue persistence was verified before activation.

Next, implement 4.1 around the existing owner-scoped rig state API and store. Neon is authoritative for revisions, with Upstash carrying presence and committed-change events to authenticated SSE subscribers.

## Resume after 4.1

The `0004_rig_collaborators.sql` migration is applied to Kinetix Neon. The existing Upstash and Clerk credentials cover the room and account lookup. No new deployment keys are needed. Validate the two-account workflow with `npm run test:e2e -- --project=desktop --grep "another account"`. The existing unit suite covers the rate limit and owner/editor rules.

For 4.2, use `lib/realtime/protocol.ts` for attributed events and `RoomBus` to publish committed agent edits. Expose only the rig bound to an MCP credential. Reuse the model, command, animation and export modules to keep studio and agent behavior aligned.

## Resume after 4.2

The `0005_rig_tokens.sql` migration is applied. Open an owned rig in Studio and select **MCP**. Create a named credential and copy the configuration while the dialog is open. HTTP clients use Streamable HTTP at `https://kinetix-chan.vercel.app/api/mcp` with `Authorization: Bearer <rig-credential>`.

For a stdio client, run `node scripts/kinetix-mcp.mjs` from an installed checkout, or point the client at the script's absolute path. Set `KINETIX_MCP_TOKEN` in that client's environment. `KINETIX_MCP_URL` optionally selects another HTTPS endpoint or a localhost development endpoint. These are client settings. Existing Vercel deployment variables cover the hosted API.

## Workspace UI follow-up

No new environment variables or migrations are needed. Use **Motion studies** on the dashboard, **Manage clips** in the timeline, and **?** in the studio to open the keyboard guide. On smaller screens the hierarchy and inspector share a resize handle. Use arrow keys on a focused separator for precise resizing.

Run `npm run test:e2e -- --grep 'member manages clips'` to verify direct navigation after rig creation, clip editing in the studio, and rename and delete from the rig card. Run the full browser suite for direct navigation from existing cards, viewport and resize assertions, and human and MCP presence.

Run `npm run test:e2e -- --project=desktop --grep "MCP agent"` for the live agent workflow. Use `npm run typecheck`, `npm test`, `npm run test:e2e` and `npm run build` before further releases. Playwright uses one worker against the local host's shared Upstash limit. Teardown removes rigs owned by the temporary Clerk fixture account before deleting that account.

## M5.1 · Blank designs and artboards

From the dashboard, use **New design** and choose an artboard size. In the studio press **G**, click to place vertices, and click the first point or choose **Close polygon**. Use the Inspector for fills, ordering, and splitting straight edges. Open **Artboard** to resize or set the background. Save, then choose **Download saved artboard PNG** in Export.

Run `npm run test:e2e -- --grep 'illustrator draws'` for the blank-design browser workflow. `npm test -- tests/unit/library.test.ts tests/unit/export.test.ts` covers the saved PNG, protected access, agent revision checks and export dimensions. M5.1 uses the existing deployment environment and JSONB column.

## First playable asset

Select a path in a saved clip and choose its X or Y keyframe channel. After the edits are saved, open **Export**, choose **Sprite package (ZIP)**, and set the range and pivot. See [engine export](ENGINE_EXPORT.md) for Godot setup and the MCP contract. The direct sprite ZIP needs the existing application services and runs without the Inngest worker.

Run `npm run test:e2e -- --grep 'keys and plays artwork'` for the browser workflow. Set `KINETIX_GODOT_PATH` to a Godot 4.5.1 executable and run `npm test -- tests/unit/godot-sprite.test.ts` for headless playback and repeat reimport.

## M5.2 · Precision editing

Press **M** and choose a rectangle, ellipse or star. Press **N** to draw a smoothed pencil stroke. Use **Q** for marquee or lasso, then align or distribute selected paths in the Inspector. Use **Guides**, **Rulers** and **Snap** in the viewport and hold **Alt** to bypass snapping while dragging. The Inspector accepts numeric position, rotation, scale and pivot edits. Use Ctrl or ⌘ + arrow keys to nudge a selected path on the focused canvas.

Run `npm test -- tests/unit/path-geometry.test.ts tests/unit/export.test.ts` for geometry and export parity. Run `npm run test:e2e -- --grep 'moves a transformed path|lays out shapes'` for the interactive workflow across all four layouts. No new service configuration or SQL migration is required.

## M5.3 · Faceted artwork

Select a closed straight-edged polygon and choose **Make faceted artwork**. Use the Facet tools to select faces, edges, or vertices directly on the canvas. Choose **Draw face** to reuse existing vertices, and hold **Alt** to place an independent vertex. Use **Preview triangulation** before applying new faces. **Split deformation triangle** operates on the separate bound mesh in Mesh weights.

Run `npm test -- tests/unit/facets.test.ts` for topology, seam opacity, and exact posed subdivision. Run `npm run test:e2e -- --grep 'three-color junction'` for the studio workflow across four layouts. This subgoal uses existing environment variables.

## M5.4 · Layers and appearance

Select a path and open **Appearance** in the inspector. Choose solid or gradient paint, or use **Manage swatches** and link a fill or stroke to a saved swatch. Select a group or path in **Layers** to assign a closed path as its clipping mask. Use **Region select** and **Combine paths** for compound paths or Boolean edits. Set **Base path** to the artwork whose ID and style should carry forward.

Run `npm test -- tests/unit/layers.test.ts tests/unit/appearance.test.ts` for nesting, save compatibility, swatch detachment, masks, Boolean results and raster/Lottie fidelity. Run `npm run test:e2e -- --grep 'groups, hides, locks|delivers a badge'` for the authenticated artist workflow. If a Windows Turbopack CSS worker exits before IPC connects, use `npm run build -- --webpack` locally and verify the default Turbopack build on Vercel. This subgoal uses existing Vercel variables and Neon storage. Lottie reports a topology error when an animated mask changes its sampled vertex layout.

## M5.5 · Drawn cels and pixel art

Create a saved clip, open **Add drawing layer** in Layers and choose indexed or RGBA. Select a pixel tool in the drawing inspector. Use **Link held cel**, **Make independent** or **Blank exposure** at the desired frame. Use **Pixel scale** in Export to render a PNG sequence, sprite sheet or fixed-grid package at an integer scale.

Run `npm test -- tests/unit/drawings.test.ts tests/unit/library.test.ts` for the held-cel sampler, pixel commands and queued export snapshots. Set `KINETIX_GODOT_PATH` to the installed Godot 4.5.1 console binary to test playback and reimport at both scales. Run `npm run test:e2e -- --grep 'recolors, and exports pixel cels'` for the authenticated browser fixture. The preview and production use the existing deployment variables. For drawings above 262,144 pixels, the exact edited bitmap appears when the stroke completes. Lottie calls for a raster profile when the range contains visible cels.

## M9.1 · Portable sprite bundles

Choose **Portable sprite bundle (ZIP)** in Export, select saved clips and a layout, then use **Check export** to see files and texture memory. Open the downloaded ZIP from `/sprite-player` to play the bundle locally. The existing **Sprite package (ZIP)** option delivers the tested version 1 fixed grid for Godot 4.5.1. The version 2 JSON Schema is at `/sprite-player/schema`.

Run `npm test -- tests/unit/sprite-bundle.test.ts tests/unit/library.test.ts` for layout, timing, color and REST/MCP parity. Run `npm run test:e2e -- --grep 'preflights and plays three layouts'` for the authenticated Studio and player workflow across four viewports. The bundle and player use the existing deployment variables and direct raster renderer. Enter per-frame sockets, collisions, event cues and custom durations under **Frame metadata** or supply them to MCP. See [the sprite contract](ENGINE_EXPORT.md).

## M9.3 · Next implementation step

Extend the Godot 4.5.1 importer to version 2. Use the existing `tests/unit/godot-sprite.test.ts` wrapper scene and add a multi-clip fixture with asymmetric trim, variable holds, rotation and a blank frame. Resolve frames by stable clip and source IDs. Preserve game-authored references and overrides while updating generated scene files. Retain version 1 coverage and verify all three layouts before publishing the expanded Godot profile. Unity, Phaser, PixiJS, Unreal and GameMaker profiles remain in M9.3.
