import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import { strToU8, zipSync } from "fflate";
import { drawArtboardBackground, drawRigArtwork } from "../rig/render";
import { artboardFor } from "../rig/model";
import { sampleExportFrames, spritesheetGrid, type ExportFrame, type ExportSnapshot } from "./frames";

function drawFrame(canvas: Canvas, frame: ExportFrame, opaque = false) {
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (opaque) {
    context.fillStyle = "#f7f5ed";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  drawArtboardBackground(context, frame.rig);
  drawRigArtwork(context, frame.rig, frame.poses, frame.phase);
}

export function renderPngFrame(snapshot: ExportSnapshot) {
  const {width, height} = artboardFor(snapshot.rig);
  const canvas = createCanvas(width, height);
  const frame = sampleExportFrames(snapshot).next();
  if (frame.done) throw new Error("There is no frame to render.");
  drawFrame(canvas, frame.value);
  return canvas.toBuffer("image/png");
}

export function renderSpritesheet(snapshot: ExportSnapshot) {
  const artboard = artboardFor(snapshot.rig);
  const frames = snapshot.endFrame - snapshot.startFrame + 1;
  const { columns, rows } = spritesheetGrid(frames, artboard.width, artboard.height);
  const sheet = createCanvas(artboard.width * columns, artboard.height * rows);
  const context = sheet.getContext("2d");
  const canvas = createCanvas(artboard.width, artboard.height);
  let index = 0;
  for (const frame of sampleExportFrames(snapshot)) {
    drawFrame(canvas, frame);
    context.drawImage(canvas, index % columns * artboard.width, Math.floor(index / columns) * artboard.height);
    index++;
  }
  return sheet.toBuffer("image/png");
}

export function renderPngSequence(snapshot: ExportSnapshot) {
  const {width, height} = artboardFor(snapshot.rig);
  const canvas = createCanvas(width, height);
  const files: Record<string, Uint8Array> = {};
  let number = snapshot.startFrame;
  for (const frame of sampleExportFrames(snapshot)) {
    drawFrame(canvas, frame);
    files["frames/" + String(number++ + 1).padStart(5, "0") + ".png"] = canvas.toBuffer("image/png");
  }
  files["sequence.json"] = strToU8(JSON.stringify({
    width, height, fps: snapshot.fps, startFrame: snapshot.startFrame + 1, endFrame: snapshot.endFrame + 1,
  }));
  return Buffer.from(zipSync(files, { level: 0 }));
}

function* rawFrames(snapshot: ExportSnapshot) {
  const artboard = artboardFor(snapshot.rig);
  const canvas = createCanvas(artboard.width, artboard.height);
  const context = canvas.getContext("2d");
  for (const frame of sampleExportFrames(snapshot)) {
    drawFrame(canvas, frame, true);
    const pixels = context.getImageData(0, 0, artboard.width, artboard.height).data;
    yield Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  }
}

export async function renderVideo(snapshot: ExportSnapshot, format: "mp4" | "webm"): Promise<Buffer> {
  const artboard = artboardFor(snapshot.rig);
  const args = [
    "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pixel_format", "rgba",
    "-video_size", artboard.width + "x" + artboard.height, "-framerate", String(snapshot.fps), "-i", "pipe:0",
    "-an", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-pix_fmt", "yuv420p", "-threads", "2",
  ];
  if (format === "mp4") args.push("-c:v", "libx264", "-preset", "fast", "-crf", "20",
    "-movflags", "frag_keyframe+empty_moov+default_base_moof");
  else args.push("-c:v", "libvpx-vp9", "-deadline", "good", "-cpu-used", "4", "-crf", "27", "-b:v", "0");
  args.push("-f", format, "pipe:1");

  const child = spawn(process.env.FFMPEG_PATH || ffmpeg.path, args, { windowsHide: true });
  const output: Buffer[] = [];
  let bytes = 0;
  let errors = "";
  let exceeded = false;
  child.stdout.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > 16 * 1024 * 1024) {
      exceeded = true;
      child.kill();
    } else output.push(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-4000); });
  const completed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => {
      if (code === 0) resolve();
      else reject(new Error(exceeded ? "Video exceeds the export size limit." : "FFmpeg exited with " + code + ": " + errors));
    });
  });
  try {
    await Promise.all([pipeline(Readable.from(rawFrames(snapshot)), child.stdin), completed]);
    return Buffer.concat(output);
  } finally {
    if (child.exitCode === null && !child.killed) child.kill();
  }
}
