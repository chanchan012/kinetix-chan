# Kinetix architecture

## Subgoal 1.1

Next.js 16 App Router renders the shell and auth pages. The interactive playground is a client island. Its three fixed motion studies are sample artwork for the landing experience. They do not implement the editable rig format planned for 2.1.

| Entry | Responsibility |
| --- | --- |
| `app/page.tsx`, `components/playground.tsx` | Guest entry, clip choice, frame slider, skeleton visibility, playback and keyboard controls |
| `components/art-canvas.tsx`, `lib/artwork.ts` | Canvas 2D facets and joint overlays, deterministic per-frame poses, pixel-ratio-aware resizing |
| `app/globals.css` | Flex shell locked to 100dvh, grid layout, touch and short-landscape adaptations, internally scrollable auth content |
| `proxy.ts` | Clerk page middleware when configured |
| `lib/api.ts` | Typed Hono RPC factory, optional verified identity, explicit private account boundary, cache policy |
| `lib/services.ts` | Clerk verification via @hono/clerk-auth and Upstash Redis sliding-window implementation |
| `app/api/[[...route]]/route.ts` | Next Node runtime adapter for Hono |
| `db/schema.ts`, `db/client.ts` | Drizzle tables and lazy Neon HTTP connection |

## API

| Method | Route | Contract |
| --- | --- | --- |
| GET | /api/health | Service liveness; no dependency probe |
| GET | /api/session | Guest returns mode and canSave=false. Verified member returns mode, Clerk userId and canSave=true for future owner-scoped operations. |
| GET | /api/account | Verified userId, or 401 for guests |

Exported `AppType` supports Hono's hc client. All APIs are throttled before identity resolution and use private, no-store responses. Exhausted windows return 429 with Retry-After. Limiter faults return 503. On Vercel the distributed limiter uses the platform-supplied client address. Outside Vercel it uses a shared local key. Guest-only mode without Redis uses a bounded, per-instance window of 120 requests per minute. Account mode requires both Upstash variables. No client-provided identity header grants access.

## Storage

The checked-in migration is `drizzle/0000_foundation.sql`. Rigs have UUID primary keys, Clerk owner IDs, names, a JSONB state document, nonnegative revision numbers and timestamps. The owner/update index supports the dashboard. Clips belong to a rig with cascading deletion, bounded fps, positive frame count and JSONB tracks. In 1.2, scope every mutation and lookup to the authenticated owner, including clip access via the parent rig. Update the revision and updated_at together when persisting edits.

## Release topology

The GitHub repository is chanchan012/kinetix-chan. Vercel builds the Next.js app from this repository, with separate feature-branch preview and main production deployments. The preview uses the Kinetix Clerk development instance. Both Vercel environments use the existing kinora Redis database. Production also has a pooled connection to the kinetix Neon database. Production currently serves guest access.

## Later milestones

Inngest thumbnails begin in 1.2. The shared command model, IK solver, timeline editing, exports, SSE and MCP resources/tools belong to subsequent subgoals. No MCP endpoint is registered in this release.
