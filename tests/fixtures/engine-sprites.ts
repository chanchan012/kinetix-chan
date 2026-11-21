import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { exportedAtlasFixture } from "./sprite-atlas";
import { spriteBundleManifest } from "../../lib/export/sprite-playback";

type Layout = Parameters<typeof exportedAtlasFixture>[0];

export async function engineSpriteFixture(layout: Layout, scale = 1, update = false) {
  const files = unzipSync(await exportedAtlasFixture(layout, scale));
  const manifest = spriteBundleManifest.parse(JSON.parse(strFromU8(files["kinetix.json"])));
  const [east, west] = manifest.clips;
  west.frames[1].events = [{ name: "stride", tick: 1, data: { foot: "left" } }];
  if (update) {
    const used = new Set(east.frames.map(frame => frame.file));
    for (const file of manifest.files) if (!used.has(file.file)) delete files[file.file];
    manifest.clips = [east];
    manifest.files = manifest.files.filter(file => used.has(file.file));
    manifest.textureBytes = manifest.files.reduce((sum, file) => sum + file.width * file.height * 4, 0);
    manifest.source.revision++;
    east.name = "Bright flicker";
  }
  files["kinetix.json"] = strToU8(JSON.stringify(manifest));
  return { bytes: [...zipSync(files)], east: east.id, west: west.id };
}
