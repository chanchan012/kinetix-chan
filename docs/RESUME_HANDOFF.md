# Resume Kinetix

Read PROGRESS.md for release state and the next exact task. Use Node 24 and npm. Run commands from the repository root.

## Local setup

```sh
npm ci
npm run dev
```

Open http://localhost:3000. The workspace's ignored .env.local is configured for the Kinetix Clerk development instance, Upstash and Neon. Use the .env.example template on fresh checkouts. With no variables configured, the app runs as a guest playground.

## Service configuration

Copy .env.example to .env.local for local development. Configure deployment variables separately for Preview and Production in Vercel.

| Variable | Purpose |
| --- | --- |
| NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY | Public key from the matching Clerk instance, required at build time for account UI |
| CLERK_SECRET_KEY | Server-only key from the same Clerk instance |
| UPSTASH_REDIS_REST_URL | Redis REST endpoint for distributed rate limiting |
| UPSTASH_REDIS_REST_TOKEN | Server-only Redis REST token |
| DATABASE_URL | Neon Postgres connection string with TLS, needed for migrations and future persistent operations |
| KINETIX_DEMO_ONLY | Test override. A value of 1 disables Clerk and Redis access for isolated browser runs. |
| PLAYWRIGHT_CHANNEL | Optional browser channel; set to chrome to use installed Google Chrome |

The initial migration has been applied to the `kinetix` database on the default branch of Neon project `still-bird-86777802`. Confirm the database and branch before running future migrations. Use the direct connection for `npm run db:migrate` and the pooled URL for Vercel. Generate future migrations with `npm run db:generate`. Redeploy Vercel after changing environment variables.

## Verification

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Playwright starts and stops an isolated guest Next dev server on port 3181. On Windows with Chrome installed, set `$env:PLAYWRIGHT_CHANNEL='chrome'` before the E2E command. The four viewport profiles are 1440×900, 768×1024, 375×667 and 844×390. The tests check document dimensions, visible controls, typed API behavior, guest access, playback, scrubbing, skeleton toggling and the quick guide. Screenshots are written under ignored test-results/.

## Known caveats

Production is https://kinetix-chan.vercel.app. Redis and Neon are configured there. Production Clerk setup needs a custom domain controlled by the project owner and matching production keys. The feature preview uses Clerk development keys for testing.

- The suite exercises actual Clerk anonymous rejection and injected authenticated identity. The guest fallback cannot save.
- The existing kinora Free Tier Redis database is shared with Kinetix. Kinetix rate-limit entries use the `kinetix:v1` prefix.
- npm audit --omit=dev reported zero known runtime advisories at release verification. The development tree reported advisories in the Vitest/Vite glob tooling and Drizzle Kit's older esbuild dependency.
- The fixed playback studies are demo data. Persistent dashboard CRUD, background jobs, IK and MCP parity have their own milestones.
