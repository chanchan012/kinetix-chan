import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { zipSync } from "fflate";

export const dynamic = "force-static";

const starterFiles = [
  ["README.md", "integrations/pixi/README.md"],
  ["package.json", "integrations/pixi/kit-package.json"],
  ["package-lock.json", "integrations/pixi/kit-package-lock.json"],
  ...[
    "integrations/pixi/kinetix-sprites.ts",
    "integrations/pixi/vite.config.ts",
    "integrations/pixi/starter/index.html",
    "integrations/pixi/starter/starter.css",
    "integrations/pixi/starter/starter.ts",
    "lib/export/sprite-playback.ts",
    "lib/rig/sprite-sources.ts",
  ].map(file => [file, file]),
];

export async function GET() {
  const files = await Promise.all(starterFiles.map(async ([name, path]) => [name, await readFile(join(process.cwd(), path))] as const));
  const zip = zipSync(Object.fromEntries(files), { mtime: new Date("2026-01-01T00:00:00Z") });
  return new Response(Uint8Array.from(zip), { headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": 'attachment; filename="kinetix-pixi-starter.zip"',
  } });
}
