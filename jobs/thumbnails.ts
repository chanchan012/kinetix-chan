import { createCanvas } from "@napi-rs/canvas";
import { drawStudy } from "../lib/artwork";
import { studyFor } from "../lib/studies";
import type { Library } from "../db/library";
import { readRigState } from "../lib/rig/model";
import { drawArtboardBackground, drawRigArtwork } from "../lib/rig/render";
import { evaluateRig } from "../lib/rig/kinematics";

export async function processThumbnails(library:Library) {
  let saved = 0;
  for (const clip of await library.pending()) {
    const canvas = createCanvas(360,200);
    const ctx = canvas.getContext("2d");
    const frame = Math.min(Math.round(clip.fps / 2),clip.frames - 1);
    if (clip.state.version === 2) {
      const rig = readRigState(clip.state);
      if (rig.version !== 2) continue;
      const {width, height} = rig.artboard;
      const scale = Math.min(360 / width, 200 / height);
      ctx.translate((360 - width * scale) / 2, (200 - height * scale) / 2);
      ctx.scale(scale, scale);
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.clip();
      drawArtboardBackground(ctx, rig);
      drawRigArtwork(ctx, rig, evaluateRig(rig), frame / clip.frames);
    } else {
      const study = studyFor(clip.state.study);
      ctx.fillStyle = study.wash;
      ctx.fillRect(0,0,360,200);
      ctx.scale(.72,.72);
      drawStudy(ctx,study.id,frame / clip.frames,false);
    }
    const image = canvas.toDataURL("image/png");
    saved += (await library.saveThumbnail(clip.id,clip.fps,clip.frames,image)).length;
  }
  return saved;
}
