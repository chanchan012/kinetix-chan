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

1.1, 1.2 and the authenticated workspace release are deployed. Next development subgoal is 2.1. Start a feature branch, define a deterministic parent/child rig fixture, and write forward-kinematics and two-bone IK tests before implementing commands, history and attribution. Hosted thumbnail execution awaits owner-managed Inngest credentials and endpoint sync.

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
