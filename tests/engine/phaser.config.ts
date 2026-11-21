import { defineConfig } from "@playwright/test";

const baseURL = process.env.KINETIX_PHASER_TEST_URL ?? "http://127.0.0.1:3182";
export default defineConfig({
  testDir: "./phaser",
  timeout: 45_000,
  workers: 1,
  use: {
    baseURL, channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    launchOptions: { args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  webServer: process.env.KINETIX_PHASER_TEST_URL ? undefined : {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3182 --strictPort",
    cwd: process.cwd(),
    url: `${baseURL}/integrations/phaser/starter/`,
    reuseExistingServer: false,
  },
});
