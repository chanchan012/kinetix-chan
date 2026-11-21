import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { zipSync } from "fflate";

export const dynamic = "force-static";

const starterFiles = [
  ["README.md", "integrations/phaser/README.md"],
  ["package.json", "integrations/phaser/kit-package.json"],
  ["package-lock.json", "integrations/phaser/kit-package-lock.json"],
  ...[
    "integrations/phaser/kinetix-sprites.ts",
    "integrations/phaser/timeline.ts",
    "integrations/phaser/vite.config.ts",
    "integrations/phaser/starter/index.html",
    "integrations/phaser/starter/starter.css",
    "integrations/phaser/starter/starter.ts",
    "lib/export/sprite-playback.ts",
    "lib/rig/sprite-sources.ts",
  ].map(file => [file, file]),
];

export async function GET() {
  const files = await Promise.all(starterFiles.map(async ([name, path]) => [name, await readFile(join(process.cwd(), path))] as const));
  const zip = zipSync(Object.fromEntries(files), { mtime: new Date("2026-01-01T00:00:00Z") });
  return new Response(Uint8Array.from(zip), { headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": 'attachment; filename="kinetix-phaser-starter.zip"',
  } });
}
