import { defineConfig } from "@playwright/test";

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

const baseURL = "http://localhost:3181";
export default defineConfig({
  globalSetup: "./tests/e2e/setup.ts",
  testDir: "./tests/e2e",
  // Browser fixtures share the app's Upstash IP bucket on localhost.
  workers: 1,
  timeout: 60000,
  use: { baseURL, channel: process.env.PLAYWRIGHT_CHANNEL || undefined, trace: "off" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "mobile", use: { viewport: { width: 375, height: 667 }, hasTouch: true } },
    { name: "landscape", use: { viewport: { width: 844, height: 390 }, hasTouch: true } }
  ],
  webServer: {
    command: "npm run dev -- --hostname localhost --port 3181",
    url: baseURL, reuseExistingServer: false, timeout: 120000,
    env: { NEXT_TELEMETRY_DISABLED: "1" }
  }
});
