import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:3181";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 2,
  timeout: 60000,
  use: { baseURL, channel: process.env.PLAYWRIGHT_CHANNEL || undefined, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "mobile", use: { viewport: { width: 375, height: 667 }, hasTouch: true } },
    { name: "landscape", use: { viewport: { width: 844, height: 390 }, hasTouch: true } }
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3181",
    url: baseURL, reuseExistingServer: false, timeout: 120000,
    env: { KINETIX_DEMO_ONLY: "1", NEXT_TELEMETRY_DISABLED: "1" }
  }
});
