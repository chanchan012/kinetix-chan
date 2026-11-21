import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { zipSync } from "fflate";

export const dynamic = "force-static";

export async function GET() {
  const names = ["README.md", "import_sprite_package.gd", "import_sprite_bundle.gd", "kinetix_sprite.gd"];
  const files = await Promise.all(names.map(async name => {
    const source = await readFile(join(process.cwd(), "integrations", "godot", name));
    return [name, source] as const;
  }));
  const zip = zipSync(Object.fromEntries(files), { mtime: new Date("2026-01-01T00:00:00Z") });
  return new Response(Uint8Array.from(zip), { headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": 'attachment; filename="kinetix-godot-importer.zip"',
  } });
}
