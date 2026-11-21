import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { rollupOptions: { input: resolve("integrations/pixi/starter/index.html") } },
});
