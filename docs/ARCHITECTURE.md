# Kinetix architecture

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
