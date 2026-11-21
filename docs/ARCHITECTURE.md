# Kinetix architecture

Planned authoring and delivery contracts live in the [production roadmap](PRODUCTION_STUDIO_ROADMAP.md). The [delivery paths](PRODUCTION_STUDIO_ROADMAP.md#choose-a-delivery-path) define the intended boundary between versioned editable source, baked frames, runtime rig data and target-specific importer outputs. The sections below record implemented contracts.

## Subgoal 1.1

Next.js 16 App Router serves a public landing page and Clerk sign-in and sign-up pages. The authenticated workspace contains the rig library and three motion studies. The editable rig format begins in 2.1.

| Entry | Responsibility |
| --- | --- |
| `app/page.tsx`, `components/study-links.tsx` | Public artwork and links into the workspace |
| `app/studio/studies/[id]/page.tsx`, `components/playground.tsx` | Server-verified member access to playback, frame scrubbing, bones and keyboard controls |
| `components/art-canvas.tsx`, `lib/artwork.ts` | Canvas 2D facets and joint overlays, deterministic per-frame poses, pixel-ratio-aware resizing |
| `app/globals.css` | Flex shell locked to 100dvh, grid layout, touch and short-landscape adaptations, internally scrollable auth content |
| `proxy.ts` | Clerk session handling and sign-in redirects for dashboard and studio paths, including deep links |
| `lib/api.ts` | Typed Hono RPC factory, optional verified identity, explicit private account boundary, cache policy |
| `lib/services.ts` | Clerk verification via @hono/clerk-auth and Upstash Redis sliding-window implementation |
| `app/api/[[...route]]/route.ts` | Next Node runtime adapter for Hono |
| `db/schema.ts`, `db/client.ts` | Drizzle tables and lazy Neon HTTP connection |

## API

| Method | Route | Contract |
| --- | --- | --- |
| GET | /api/health | Service liveness; no dependency probe |
| GET | /api/session | Verified member returns mode, Clerk userId and canSave=true. Signed-out requests return 401. |
| GET | /api/account | Verified userId, or 401 for guests |

Exported `AppType` supports Hono's hc client. Hono throttles requests before identity resolution and uses private, no-store responses. Exhausted windows return 429 with Retry-After. Limiter faults and missing authentication configuration on private APIs return 503. Upstash keys requests by the platform-supplied client address on Vercel and a shared local bucket elsewhere. The session identity used for database access comes from Clerk verification.

## Storage

The checked-in migration is `drizzle/0000_foundation.sql`. Rigs have UUID primary keys, Clerk owner IDs, names, a JSONB state document, nonnegative revision numbers and timestamps. The owner/update index supports the dashboard. Clips belong to a rig with cascading deletion, bounded fps, positive frame count and JSONB tracks. In 1.2, scope every mutation and lookup to the authenticated owner, including clip access via the parent rig. Update the revision and updated_at together when persisting edits.

## Release topology

Vercel builds feature previews and production from the GitHub repository chanchan012/kinetix-chan. Both targets use the same page guards and the Kinetix Clerk development instance. Vercel holds deployment credentials for Clerk, the existing kinora Redis database and the kinetix Neon database.

## Subgoal 1.2

The landing page links to `/dashboard` and `/studio/studies/[id]`. Both page implementations call `auth.protect()` before rendering. The proxy preserves the requested local path and query when sending a visitor to sign in. Direct sign-in defaults to the dashboard. Members can create a rig from a study, rename or delete it, and manage its animation clips. The dashboard has a fixed viewport shell with an internally scrollable library.

| Resource | Methods | Data |
| --- | --- | --- |
| /api/rigs | GET, POST | List the caller's rigs or create one with name and study (fox, heron, fish). |
| /api/rigs/:id | GET, PATCH, DELETE | Read, rename, or delete a rig and its dependent clips. |
| /api/rigs/:id/clips | GET, POST | List clips including thumbnails or create a clip with name, fps and frameCount. |
| /api/rigs/:id/clips/:clip | PATCH, DELETE | Update name and timing together or delete the clip. |

Hono verifies identity before each library request. SQL predicates enforce the owner for rig operations and the parent rig for clip operations. Guest requests return 401, inaccessible resources return 404, and invalid bodies return 400. FPS ranges from 1 to 120, frame counts from 1 to 36,000, and names from 1 to 120 trimmed characters. Rig renames advance revision and updated_at.

Migration `0001_clip_thumbnail.sql` adds nullable PNG data URLs to clips. A null thumbnail is the durable work queue. Inngest polls up to 50 pending clips every five minutes through `/api/inngest`. Its worker uses the same character drawing functions as the browser at a representative clip frame. The write verifies that timing still matches and the thumbnail is still pending. Editing the clip invalidates its thumbnail. Repeated runs are safe, and the dashboard refreshes pending previews while the clip list is open.

## Subgoal 2.1

`lib/rig/model.ts` defines the version-1 JSONB document. Each bone has a stable ID, optional parent, local translation and rotation, and positive length along its local x-axis. Coordinates follow the canvas convention with y increasing downwards. Rotations are in radians. Graph validation rejects duplicate IDs, missing parents and cycles. Legacy study-only records hydrate to deterministic starter bones when read. Saving persists the hydrated structure in the existing JSONB column.

`forwardKinematics` composes bone transforms parent first. `evaluateRig` resolves two-bone constraints ancestor first against world-space targets, clamps unreachable distances, and leaves authored angles available for subsequent edits. Each constrained lower bone starts at its upper bone's tip. A bone can participate in one IK pair.

`createRigStore` creates an independent Zustand store for one rig. Command groups validate atomically and use Immer forward and inverse patches for up to 100 undo entries. Each entry records a human or AI actor ID. Local history lives within the store instance. Opening a fresh state starts a fresh history.

| Resource | Methods | Contract |
| --- | --- | --- |
| /api/rigs/:id/state | GET | Owner-scoped saved rig with hydrated state and revision. |
| /api/rigs/:id/state | PATCH | Owner-scoped write using revision and full validated state. A conflicting revision returns 409 and the current revision. |

State saves keep the original study and update revision and updated_at in the same conditional SQL statement. This release uses the existing database schema.

## Subgoal 2.2

`/studio/[id]` checks the Clerk session and reads the rig with the owner predicate before rendering. The dashboard opens the route from a rig's detail dialog. The server sends clip timing metadata without thumbnail data. The 100dvh studio lays out its hierarchy and inspector beside the canvas at wide sizes and below it on mobile, with internal panel scrolling.

`components/studio/viewport.tsx` uses a pixel-ratio-aware Canvas 2D renderer. Pointer gestures preview bone rotation, IK target movement and path edits, then commit one attributed command on release. Drawing a child near the parent's tip snaps it to the exact IK joint. The inspector exposes local bone transforms in degrees for display and world-space IK targets. Save persists the rig document with its revision. A stale save keeps the local edits and offers a confirmed reload.

The version-1 document accepts `parts` and defaults older documents to an empty array. Parts store optional bone parents, translations, color, path closure, and anchors with cubic control handles. `lib/rig/render.ts` renders rigid bone attachments over the study artwork. The stock artwork provides a visual reference and follows the root transform. Timeline playback uses saved clip timing and the study loop. Editable keyframe sampling and weighted deformation begin in 3.1.

## Subgoal 3.1

`clips.tracks` stores typed channels for bone translation and rotation and for IK target position. Frame indexes start at zero. Rotation values use radians in storage and degrees in the studio. Keys hold their first and last values outside the keyed span. Between keys, `sampleRig` evaluates the outgoing cubic Bézier in time space and returns a sampled document for the shared rig renderer. The dope sheet edits individual keys and outgoing control points. Onion skinning draws neighboring frames behind the active frame. The Base pose toggle lets the artist inspect the authored rig while a keyed clip is open.

| Resource | Methods | Contract |
| --- | --- | --- |
| /api/rigs/:id/clips/:clip/tracks | GET | Owner-scoped clip timing, tracks and trackRevision. |
| /api/rigs/:id/clips/:clip/tracks | PATCH | Validated track document with expected trackRevision. Stale writes return 409. |

Migration `0002_clip_track_revision.sql` initializes `clips.track_revision` for existing rows. Timing edits advance the same revision. Shortening a clip drops out-of-range keys within the timing update.

Closed paths can store a triangulated mesh and bind transforms for the bones. Weight strokes modify up to four normalized influences per vertex. Deformation uses the weighted bone transforms at the sampled pose. Painting commits through the rig command store and is persisted with the rig's revision.

## Subgoal 3.2

Export requests capture a point-in-time copy of the saved rig, clip timing, tracks and inclusive frame range. The renderer shares the studio sampler, FK/IK and skinning. Lottie keeps editable vector paths with sampled, held shape keys. Raster outputs use Canvas 2D at 512×320. PNG sequences include frame numbers and a timing manifest in the ZIP. FFmpeg pipes generated frames to H.264 MP4 or VP9 WebM.

| Resource | Methods | Contract |
| --- | --- | --- |
| /api/rigs/:id/exports | POST | Queues a saved rig or clip snapshot. The client UUID makes retries idempotent. |
| /api/rigs/:id/exports | GET | Returns recent jobs for the owner with queued, running, ready or failed status. |
| /api/rigs/:id/exports/:job/download | GET | Streams the completed artifact as an owner-only attachment. |

`0003_export_jobs.sql` adds jobs and private artifacts indexed by rig and status. Removing a rig cascades to its exports. Inngest job events request immediate rendering, and a minute schedule picks up queued work or expired leases. Workers commit bytes only while holding their lease. Artifacts are limited to 16 MiB. Frame caps per job are 180 for Lottie, 96 for spritesheets, 150 for ZIP and 240 for video, with a lower bound for dense meshes based on render complexity.

## Subgoal 4.1

Owners can grant editor access to another verified Clerk account through the studio Share dialog. `rig_collaborators` stores that grant, which enables editing of the rig and its clips. Rig rename, deletion, access management and export history belong to the owner.

Hono serves `POST /api/rigs/:id/presence` and `GET /api/rigs/:id/events`. Connection snapshots carry current presence and the latest revision. Upstash hashes cache short-lived presence and small saved state documents, and Pub/Sub delivers changes to SSE subscribers. Server-side session identity determines the actor type and ID. Reconnecting reads the revision from Neon, and membership changes close revoked streams.

The studio debounces writes to the existing revision-checked state endpoint. A clean session fetches a newer saved document after a room change. A dirty session keeps its local edits and exposes a conflict. Polling snapshots and automatic SSE reconnects recover missed notifications. Remote refresh establishes a fresh local undo history.

## Subgoal 4.2

`/api/mcp` uses the Hono adapter and MCP TypeScript SDK v2 with stateless Streamable HTTP. The owner-only `/api/rigs/:id/mcp-credentials` API lists, issues and revokes credentials. `rig_tokens` stores only the SHA-256 digest and expiry of the random credential. A credential is shown once at issuance, expires in 30 days, and is bound to one rig.

The stdio bridge in `scripts/kinetix-mcp.mjs` forwards tool and resource requests to the same authenticated endpoint. Both transports expose `rig-hierarchy`, `timeline-summary`, and `viewport-bounds`. Tool schemas live in `lib/mcp/actions.ts`. Tools create bones, attach IK, draw and bind vectors, create clips, insert keys, set easing, generate procedural cycles, bake IK and queue Lottie exports.

Agent mutations reuse owner-checked revisions and publish AI presence and rig or timeline events. The studio follows new and changed clips without a page reload. Local edits retain their draft on a revision conflict, and both rig state and keyframes autosave. IK baking inserts pose keys and a clip-local enable channel, so the saved rig keeps its original constraint.

## Dashboard and studio workspace

Dashboard cards link to the authenticated studio. Owners rename or delete rigs from the card menu, and Motion studies opens a separate dialog of the existing study links. The studio timeline opens clip management against the existing `/api/rigs/:id/clips` routes. Its clip picker refreshes against the animation endpoint after changes and SSE notifications. Newly created clips become active, and deleting the active clip returns the timeline to study playback. Save pending keyframe edits to enable clip management.

The canvas carries floating drawing and contextual controls. The hierarchy, inspector and timeline use pointer- and keyboard-operable resize separators. At widths of 720 pixels and below the side panels sit beneath the canvas and share a separator. Panel sizes are local to the open studio. Header avatars show current session presence and remote selections from the existing room protocol. This release adds no schema, API, or MCP contract changes.

## M5.1 · Blank designs and artboards

`rigs.state` accepts version 2 blank designs with `study: null`, an artboard and the existing bone, constraint and part lists. The artboard permits a 16–4096 pixel width and height, a named canvas and an optional solid background. Version 1 study rigs keep their camera framing and 512 × 320 export size. Existing study-only rows still resolve through the legacy reader. Library saves guard the document kind and revision in the same write.

The dashboard creates a blank design by posting `{name,artboard}` to `/api/rigs`. Create a polygon with straight vertices and adjust it through the same path entries as the Bézier pen. The command store supports artboard settings, stack order and straight-edge midpoint insertion with undo. Revising a skinned path's vertices clears its mesh binding under the existing binding behavior.

`GET /api/rigs/:id/artboard.png` renders the saved base pose for an authorized rig editor. It preserves transparency and exact pixel dimensions. Raster animation and Lottie use the same artboard geometry. Video pads odd sizes to even dimensions for YUV 4:2:0 encoding. Raster animation jobs enforce frame, image area and output size limits.

MCP `viewport-bounds` returns the document dimensions. `rig-hierarchy` includes editable parts. `edit_document` applies up to 100 shared rig commands as a single transaction at an explicit revision and emits a room update. An edit at a stale revision fails before writing.

## First playable asset · Path position and sprite delivery

`part` tracks key the X and Y components of a vector part's local offset. Clip tracks use the existing revision-checked JSONB storage and the shared sampler for preview, raster export and Lottie. Existing clip tracks retain their original interpretation. The timeline selects a part from its key marker and uses the sampled value when inserting a key between existing keys.

`POST /api/rigs/:id/sprite-package` and the scoped MCP tool `export_sprite_package` use an owner-authorized query that reads art and clip revisions together. Supply `clipId`, `revision`, `trackRevision`, and an inclusive zero-based frame range. Supply `preflight: true` to return the planned manifest. Rendering validates revisions again and returns the ZIP, or the same bytes as base64 through MCP.

The ZIP contains `kinetix.json` and `atlas.png`. Manifest version 1 describes an unrotated, untrimmed fixed grid with straight alpha. Each frame rectangle, original size, trim offset and pivot uses pixels from the top-left. One duration tick equals one frame at the integer clip frame rate. Pivot defaults to bottom center and can be set on export. The manifest includes the atlas SHA-256 and stable rig and clip IDs. Direct rendering supports up to 96 frames, a 16-megapixel atlas, and a 1.5 MB archive. See [engine export](ENGINE_EXPORT.md) for importer behavior.

## M5.2 · Precision editing

Vector parts accept optional rotation in radians, signed scale and a local pivot. The part matrix maps source vertices into the parent's plane. The viewport uses its inverse for node editing, and skinning uses the same transform before bone deformation. Canvas and Lottie trace paths in document coordinates with a consistent document-pixel stroke width. Missing transforms resolve to identity. Pivot edits compensate the stored position to keep the base shape in place.

Marquee and lasso use artwork bounds in document coordinates. Align and distribute work from transformed curve extrema. Group movement, edge subdivision, node mode, reverse, cut, join and simplification are undoable commands. Splitting a cubic preserves its shape and retains any attached deformation mesh. Smooth nodes maintain aligned control handles during editing.

Version 2 artboards can store up to 64 guides. The viewport displays them and can snap to them, the artboard edges or a 10 px grid within an eight-screen-pixel tolerance. Alt bypasses snapping for the current drag. Guides are available through MCP's viewport resource. MCP can create primitives and smoothed pencil paths using the same geometry functions as the studio, and use `edit_document` for transforms and layout.

## M5.3 · Faceted artwork

A closed vector part can carry a `facets` graph with stable vertex and face IDs and a solid fill for each face. An edge may belong to two faces on opposite sides. Winding, simple perimeters and vertex references are validated after edits. Vertex and edge edits update all incident faces. The editor supports drafting against existing vertices, isolated vertex creation with Alt, face colors, sampling, cuts, welding, mirroring, and triangulation with a preview.

The visual graph and skin mesh have independent topologies. A bound part projects color regions through the piecewise-affine deformation computed by the existing skin solver. A mesh triangle split adds a center vertex that follows the mean of its three posed source vertices. Painting independent weights onto that vertex moves it to the regular bone-influence evaluator. The facet graph and face colors carry through the split. Canvas and the export renderers share this geometry.

MCP uses `edit_document` for `facet.initialize`, `facet.add`, `facet.move`, `facet.paint`, `facet.splitEdge`, `facet.cut`, `facet.weld`, `facet.mirror`, `facet.triangulate`, and `mesh.splitTriangle`. The hierarchy resource includes the graph and independent mesh through the vector part. The saved format gains optional JSON fields and needs no migration.

## M5.4 · Layers and vector appearance

The saved rig can carry a version 1 `layers` tree in either rig document version. Part nodes reference stable path IDs. Group nodes define parentage, sibling order, inherited visibility and inherited locking. Existing documents derive their order from the original part array. Canvas isolation is local to the studio. Canvas and exports traverse visible parts in the same order.

`appearance` supports solid and linear paints, opacity, and a stroke with width, cap, join, miter limit, dash lengths and offset. Gradient endpoints are in part-local coordinates. A paint can reference a document `swatches` entry. Updating one swatch updates all uses. Removing it materializes its paint wherever it was referenced. Older parts retain their original fill or open-path stroke. A faceted part retains its own per-face palette by default.

A part or group can reference a closed drawing as a clipping mask. The renderer intersects inherited mask regions in document space. A hidden mask drawing continues to define its region. Compound contours render with even-odd fill and preserve Bézier handles on ordinary vectors. Union, subtraction, intersection and exclusion approximate curved boundaries with polygons in document space, preserve the base part ID and consume the operands as one undoable edit. Compound contours use the unskinned vector renderer. Lottie captures gradients, fill rules, stroke parameters and clipping paths. It reports animated masks whose sampled polygon topology changes across frames.

MCP `rig-hierarchy` returns the resolved layer tree, swatch catalog and part appearance. `edit_document` applies revision-checked `layer.group`, `layer.ungroup`, `layer.rename`, `layer.move`, `layer.flags`, `layer.mask`, `layer.duplicate`, `swatch.set`, `swatch.remove`, `part.update` and `parts.boolean`. The same commands back studio edits and undo. Optional JSON fields use the existing saved rig column and require no SQL migration.

## M5.5 · Drawn cels

The optional `drawings` version 1 catalog lives in the saved rig JSON. Each entry joins one `drawing` node in the artwork tree and owns its dimensions, color storage, cels and exposure tracks. Pixel runs use `[row, left, width, ink]` in top-left drawing coordinates. Runs are sorted, disjoint and merged by ink. Transparent areas are gaps. RGBA ink is a packed unsigned `0xRRGGBBAA` value. Indexed ink stores a palette index times 256 plus pixel alpha. Recoloring the palette changes the display without rewriting each cel.

A drawing has a base cel and optional clip-scoped exposure tracks. One exposure starts at its key frame and holds until the next key. A null ID starts a transparent hold. Reusing a cel ID links the drawings across exposures. Creating a cel with a source ID copies its pixels for independent edits. Stable references allow one command batch to create a drawing, add or copy cels, and assign exposures. Drawing nodes follow the same stacking, masking, visibility and lock rules as vector nodes.

The shared pixel edit command handles pencil, pressure brush, eraser, contiguous fill and nearest-neighbor selection transforms. Studio rasterizes the sampled cel into a nearest-filtered Canvas bitmap. Sprites and PNG sequences sample the same exposure and render at integer scale. Each sprite frame still uses one tick at the clip frame rate, including held and blank frames. Frame dimensions and pivots scale together. Export snapshots pin the source revision and clip ID. Lottie preflight rejects visible raster cels in the requested range. Static PNG uses the base drawing.

MCP `edit_document` accepts `drawing.create`, `drawing.remove`, `drawing.palette`, `drawing.rest`, `cel.create`, `cel.edit`, `cel.replace`, `cel.remove`, `exposure.set` and `exposure.remove`. `rig-hierarchy` exposes drawing metadata, clip exposures and cel IDs. Use `read_drawing_cel` with an optional pinned revision and cursor offset to page pixel runs. Changes use the existing rig revision and presence system.

## M9.1 · Portable sprite bundles

`POST /api/rigs/:id/sprite-bundle` and `export_sprite_bundle` check an owner-scoped art revision and every selected clip's track revision. The shared raster sampler feeds an independent layout step for loose frame PNGs, uniform grids or packed pages. The packed profile finds alpha bounds, shares identical cropped textures across clips, optionally rotates sprites clockwise, and writes edge extrusion inside transparent cell padding. Preflight uses the same frame bounds and texture placement as the download.

The version 2 manifest includes file digests, scaled frame geometry and clip timebases. Per-frame sockets, collision shapes and cue payloads come from the export request. Project-level authoring for these values belongs to M6.4. The player validates texture digests, restores trim and rotation, normalizes pixel scale, and reads variable holds and loop modes. It performs playback locally at `/sprite-player`. The version 1 export remains available through the fixed-grid profile. See [the sprite export contract](ENGINE_EXPORT.md).

## M9.3 · Godot sprite adapter

The static download at `/sprite-player/godot` packages the scripts in `integrations/godot` at build time. The Godot command reads legacy fixed grids or version 2 bundles supplied by Studio, REST or MCP. It validates all version 2 textures and forward timing before staging any files. Standalone texture resources are shared by crop dimensions and pixel digest. Aggregate and per-clip `SpriteFrames` use the manifest timebase, per-frame holds and a sequence for ping-pong playback. The generated sprite script applies `trimOffset - pivot`, exposes current frame and socket data, and emits cues during playback.

Generated project paths use stable rig and clip IDs. The aggregate resource keeps the historical animation-key mapping across renames and subset imports. A per-rig lock serializes imports. Version 2 stages outputs, backs up prior files and rolls back a failed replacement. Replacing generated files leaves game-owned scenes and overrides in the game project. The download and importer use the existing bundle schema and require no changes to database, REST or MCP contracts.

## M9.3 · Phaser sprite profile

`/sprite-player/phaser` publishes a static ZIP containing the Phaser 3.90.0 starter scene, npm lockfile, scene adapter and the existing browser-safe version 2 decoder. It accepts existing Studio, REST and MCP sprite exports and uses their manifest as the timing and identity contract. It requires no server or database changes.

`KinetixPhaserLibrary` validates the source ZIP and texture digests, normalizes frame pixels, and stages native textures with transparent borders so trimmed and full-frame layouts sample consistently. The library caps restored and retained textures at 16 megapixels and checks the WebGL renderer's texture limit. The game owns a stable Phaser container whose origin matches the authored pivot. Its child image follows the frame clock independently of game-owned children, transforms and listeners. Sockets and collision coordinates are in pivot-relative scene units. Interior ping-pong holds visit their cues on both passes.

Imports are serialized per library. A revision replaces available clips by stable source ID, keeps omitted clips and refreshes active containers before releasing retired textures. Failed staging leaves the active library available. The receipt records the target and bundle versions, source revision, package digest, included clips and retained clips. See [Phaser package setup](ENGINE_EXPORT.md#import-and-update-in-phaser-3900).

## M8.1 · Editable SVG import

`lib/rig/svg-import.ts` converts XML to the existing `part.create`, `layer.group`, `layer.flags` and `layer.mask` commands. It resolves viewports and transforms into artboard coordinates, reconstructs editable cubic handles, and stores clipping geometry on hidden layers. The parser accepts UTF-8 files up to 512 KiB and bounds XML, reference expansion and command counts. Local references resolve against the document's own IDs. Studio reads the source XML in the browser and draws the proposed group through the regular Canvas path. It dispatches one history entry and saves the normalized document through the existing state endpoint.

Optional fields in the existing rig JSON preserve a vector part's SVG `fillRule`, independent `appearance.fillOpacity` and stroke opacity, and alpha on linear gradient stops. Rendering, hit testing, and clipping use the stored fill rule. Lottie writes paint opacity and gradient alpha alongside color values. Earlier compound paths retain the even-odd default. These additive fields need no database migration.

`import_svg` uses the same command planner under the credential's rig scope. Inputs are the saved `revision`, `svg` text, optional `name` and `importId`, `placement` (`original` or `fit`), and `preflight`. A preflight validates the batch and returns the provisional group, placement and line-numbered diagnostics without saving. An apply persists the batch at the requested revision and emits the normal AI-attributed room event. Pass back the preflight's `importId` to retain its proposed IDs. A stale revision or failed final validation leaves the document intact.

## M8.1 · PNG sequence import

`lib/import/png-sequence.ts` reads bounded sequence ZIPs and checks paths, frame numbers, dimensions and PNG data before building an editable drawing. Kinetix `sequence.json` supplies the frame range and FPS. External sequences use consecutive numbered PNGs and the caller's FPS. The destination clip starts at frame zero. Identical consecutive samples share an exposure. Blank samples use a null cel ID, and a pose that returns after another exposure gets an independent editable cel. Pixel data uses the existing RGBA run model. The drawing is visible in the imported clip and leaves other clips' exposures alone.

`POST /api/rigs/:id/imports/png-sequence` and MCP `import_png_sequence` accept `revision`, base64 `archive`, `name`, optional `importId`, `fps`, `resizeArtboard` and `preflight`. Preflight returns dimensions, timing, cel and exposure counts, capacity notes and a first-visible-frame preview when available. REST carries the preview in `receipt.previewPng`. MCP emits it as image content. The import ID also identifies the new clip. `Library.saveRasterImport` uses one PostgreSQL statement to save the drawing state and create its clip. The statement checks edit access and the saved revision, and a failed insert rolls back the state write. The existing room bus publishes the committed revision and updated timeline. Studio loads the committed state and starts a fresh undo history. No database migration is required.

## M8.1 · Portable sprite atlas import

`lib/import/sprite-atlas.ts` reads the existing version 2 sprite contract through `openSpriteBundle`. It validates texture digests and placement, restores straight sRGB pixels from rotated and trimmed crops, and creates one editable RGBA drawing with one exposure track per source clip. Held and transparent frames map onto integer tick boundaries. Consecutive identical cels can share an exposure while their original companion timing remains available. The uploaded source is bounded by the sprite ZIP limit, the 4096 px editable cel dimension, the 36,000-tick clip limit and the drawing pixel-run budget.

`POST /api/rigs/:id/imports/sprite-bundle` and MCP `import_sprite_bundle` accept `revision`, base64 `archive`, optional `name` and `importId`, `resizeArtboard`, and `preflight`. Preview returns clip directions, loop modes, timebase, dimensions, companion counts and the first visible frame. Reuse the preflight ID on apply. `Library.saveRasterImport` saves the rig state and inserts all new clips in one guarded PostgreSQL statement. A stale revision or failed insert publishes no partial state. The existing room bus announces the saved rig and its clips. Studio reloads the committed state and starts a fresh undo history.

The additive `spriteSources` field stores imported clip IDs and source identities, original scale, direction, loop mode and per-frame pivot, origin, socket, collision and cue data. A portable sprite export with `preserveImportedTiming: true` samples the current artwork at authored boundaries and any newly edited exposure boundaries. Animated tracks are sampled at each selected tick. The exporter rebases cues into the emitted holds and sets the package scale from the original pixel scale and the new raster multiplier. A bundle must use one compatible final world scale. Existing documents and exports continue to use their original schema versions. No database migration or service variable is required.

## M8.1 · Editable project archive

The version 1 Kinetix project ZIP contains `manifest.json`, `document.json` and `animation.json`. The manifest records the source project ID and revision, document dependencies, bytes and SHA-256 digests of both payloads, and counts of references removed for deleted clips or channels. The project document carries current artwork, layers, bones, guides, swatches, cels, exposure links and sprite companions. Saved clips carry their own frame counts, FPS, tracks and track revisions. Study projects name the built-in study dependency. The format excludes account data and credentials, sharing settings and derived jobs.

`POST /api/rigs/:id/project-archive` and scoped MCP `export_project_archive` require the document revision and the complete set of clip IDs and track revisions. `Library.projectSnapshot` reads them in one PostgreSQL statement. Preflight returns the manifest, summary and ZIP size. Export creates the same bytes for identical inputs. The limit is 128 clips, 16 MiB decoded and 2 MiB compressed.

`POST /api/rigs/project-archive` verifies required entries and digests, then validates the document, clip tracks and cross-file references. A successful apply assigns fresh project and clip IDs, rewrites clip references in drawing exposure tracks and sprite metadata, and creates the copy and all clips in one database statement. The new revision counters start at zero. Keep the same `importId`, archive and name when retrying to reuse the created copy. Migration `0006_project_archive_grant.sql` adds the owner-controlled MCP grant. Only opted-in credentials list `reopen_project_archive`. The grant can create new private projects under the same owner. The existing token still reads and edits its original rig.

## M8.1 · Reusable image assets

The optional `images` catalog contains project-owned PNG and WebP metadata and original bytes keyed by SHA-256. Image layers carry an asset ID, a position, size, rotation, opacity, a visibility mode and an optional bone attachment. Placements participate in the existing layer tree, masks and groups. Replacing an asset preserves its ID and the layout of every placement. Bone attachment and removal preserve the placement in the saved pose. Image movements enter the same undo history as other scene commands.

`POST /api/rigs/:id/image-assets/inspect` accepts base64 image data from authorized editors and returns dimensions, media type and digest. Saving the document validates the actual image bytes against the metadata. `import_image_asset` imports or replaces a specified asset ID at the supplied revision. `place_image_asset` creates a reference or artwork placement. `read_image_asset` returns metadata and visually inspectable image content. The MCP hierarchy lists available assets and their placement IDs.

Studio collects named references, folders, thumbnail previews, search and usage counts in **Image assets**. Reference-only layers are excluded from clean renders. Artwork layers render through the existing raster sampler in PNG, sprite and video exports. Lottie preflight reports visible image artwork as requiring a raster profile. Missing visible artwork must be relinked before raster delivery.

Version 2 project ZIPs with image dependencies store each image once under its digest. The document keeps asset metadata and placement bindings. The manifest identifies each dependency and its payload. The reader rejects mismatching payloads and preserves named dependencies when the payload is absent, so the recipient can relink them in Studio or MCP. Version 1 ZIPs remain readable. No migration or environment variables are needed.
