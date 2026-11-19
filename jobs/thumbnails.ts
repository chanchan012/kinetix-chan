import { createCanvas } from "@napi-rs/canvas";
import { drawStudy } from "../lib/artwork";
import { studyFor } from "../lib/studies";
import type { Library } from "../db/library";

export async function processThumbnails(library:Library) {
  let saved = 0;
  for (const clip of await library.pending()) {
    const study = studyFor(clip.state.study);
    const canvas = createCanvas(360,200);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = study.wash;
    ctx.fillRect(0,0,360,200);
    ctx.scale(.72,.72);
    const frame = Math.min(Math.round(clip.fps / 2),clip.frames - 1);
    drawStudy(ctx,study.id,frame / clip.frames,false);
    const image = canvas.toDataURL("image/png");
    saved += (await library.saveThumbnail(clip.id,clip.fps,clip.frames,image)).length;
  }
  return saved;
}
