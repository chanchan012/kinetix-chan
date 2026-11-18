# Resume Kinetix

Read PROGRESS.md for release state and the next exact task. Use Node 24 and npm. Run commands from the repository root.

## Local setup

```sh
npm ci
npm run dev
```

Open http://localhost:3000. The default is a self-contained guest playground. Select a study, play/pause, step with the focused frame slider, or toggle Bones. Sign-in and sign-up offer guest entry when Clerk is unconfigured.

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

After selecting the intended Neon project and branch, run `npm run db:migrate`. Generate future schema migrations with `npm run db:generate`. No migrations run automatically at build time. Configure Clerk domains and both key pairs before exercising account mode. Redeploy after changing public keys.

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

- The suite exercises actual Clerk anonymous rejection and injected authenticated identity. A live sign-in with the intended Clerk tenant requires its keys. The guest fallback cannot save.
- The guest limiter is process-local without Redis. Use Upstash for shared limits across Vercel instances.
- npm audit --omit=dev reported zero known runtime advisories at release verification. The development tree reported advisories in the Vitest/Vite glob tooling and Drizzle Kit's older esbuild dependency.
- The fixed playback studies are demo data. Persistent dashboard CRUD, background jobs, IK and MCP parity have their own milestones.
