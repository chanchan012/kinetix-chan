import { defineConfig } from "@playwright/test";

const baseURL = process.env.KINETIX_PIXI_TEST_URL ?? "http://127.0.0.1:3184";
export default defineConfig({
  testDir: "./pixi",
  timeout: 45_000,
  workers: 1,
  use: {
    baseURL, channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    launchOptions: { args: ["--enable-webgl", "--enable-unsafe-webgpu", "--enable-unsafe-swiftshader"] },
  },
  webServer: process.env.KINETIX_PIXI_TEST_URL ? undefined : {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3184 --strictPort",
    cwd: process.cwd(),
    url: `${baseURL}/integrations/pixi/starter/`,
    reuseExistingServer: false,
  },
});
