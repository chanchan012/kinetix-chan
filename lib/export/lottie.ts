import { drawArtboardBackground, drawRigArtwork, type RigDrawingContext } from "../rig/render";
import { sampleExportFrames, type ExportSnapshot } from "./frames";
import { artboardFor } from "../rig/model";

type Vec = [number, number];
type Color = [number, number, number];
type Matrix = [number, number, number, number, number, number];
type Shape = { i: Vec[]; o: Vec[]; v: Vec[]; c: boolean };
type Mark = { path: Shape; color: Color; width: number | null };
type GraphicsState = { matrix: Matrix; fill: unknown; stroke: unknown; width: number };

const zero = (): Vec => [0, 0];
const rounded = (number: number) => Math.round(number * 10_000) / 10_000;
const delta = (to: Vec, from: Vec): Vec => [rounded(to[0] - from[0]), rounded(to[1] - from[1])];
const identity: Matrix = [1, 0, 0, 1, 0, 0];

function colorOf(style: unknown): Color {
  if (typeof style !== "string" || !/^#[0-9a-f]{6}$/i.test(style)) {
    throw new Error("Lottie export requires solid six-digit path colors.");
  }
  return [1, 3, 5].map(position => Number.parseInt(style.slice(position, position + 2), 16) / 255) as Color;
}

/** Capture the subset of Canvas commands used by rig artwork, resolving transforms to artboard coordinates. */
class VectorCapture implements RigDrawingContext {
  fillStyle: unknown = "#000000";
  strokeStyle: unknown = "#000000";
  lineWidth = 1;
  readonly marks: Mark[] = [];
  private matrix = identity;
  private readonly stack: GraphicsState[] = [];
  private paths: Shape[] = [];
  private current: Shape | undefined;

  private point(x: number, y: number): Vec {
    const [a, b, c, d, e, f] = this.matrix;
    return [rounded(x * a + y * c + e), rounded(x * b + y * d + f)];
  }

  save() {
    this.stack.push({ matrix: this.matrix, fill: this.fillStyle, stroke: this.strokeStyle, width: this.lineWidth });
  }
  restore() {
    const state = this.stack.pop();
    if (!state) return;
    this.matrix = state.matrix;
    this.fillStyle = state.fill;
    this.strokeStyle = state.stroke;
    this.lineWidth = state.width;
  }
  translate(x: number, y: number) {
    const [a, b, c, d, e, f] = this.matrix;
    this.matrix = [a, b, c, d, x * a + y * c + e, x * b + y * d + f];
  }
  rotate(angle: number) {
    const [a, b, c, d, e, f] = this.matrix;
    const sine = Math.sin(angle);
    const cosine = Math.cos(angle);
    this.matrix = [
      a * cosine + c * sine, b * cosine + d * sine, c * cosine - a * sine, d * cosine - b * sine, e, f,
    ];
  }
  beginPath() {
    this.paths = [];
    this.current = undefined;
  }
  moveTo(x: number, y: number) {
    this.current = { v: [this.point(x, y)], i: [zero()], o: [zero()], c: false };
    this.paths.push(this.current);
  }
  lineTo(x: number, y: number) {
    if (!this.current) {
      this.moveTo(x, y);
      return;
    }
    this.current.v.push(this.point(x, y));
    this.current.i.push(zero());
    this.current.o.push(zero());
  }
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    const path = this.current;
    if (!path) {
      this.moveTo(x, y);
      return;
    }
    const end = this.point(x, y);
    path.o[path.v.length - 1] = delta(this.point(x1, y1), path.v.at(-1)!);
    path.v.push(end);
    path.i.push(delta(this.point(x2, y2), end));
    path.o.push(zero());
  }
  closePath() { if (this.current) this.current.c = true; }
  arc(x: number, y: number, radius: number, start: number, end: number, counterclockwise?: boolean) {
    const full = Math.PI * 2;
    const sweep = counterclockwise ? -((start - end + full) % full || full) : ((end - start + full) % full || full);
    const count = Math.ceil(Math.abs(sweep) / (Math.PI / 2));
    const firstX = x + radius * Math.cos(start);
    const firstY = y + radius * Math.sin(start);
    if (this.current) this.lineTo(firstX, firstY);
    else this.moveTo(firstX, firstY);
    for (let index = 0; index < count; index++) {
      const a = start + index * sweep / count;
      const b = a + sweep / count;
      const tangent = (4 / 3) * Math.tan((b - a) / 4) * radius;
      const ax = x + radius * Math.cos(a), ay = y + radius * Math.sin(a);
      const bx = x + radius * Math.cos(b), by = y + radius * Math.sin(b);
      this.bezierCurveTo(ax - tangent * Math.sin(a), ay + tangent * Math.cos(a),
        bx + tangent * Math.sin(b), by - tangent * Math.cos(b), bx, by);
    }
  }
  private capture(color: Color, width: number | null) {
    for (const path of this.paths) if (path.v.length >= 2) this.marks.push({ path, color, width });
  }
  fill() { this.capture(colorOf(this.fillStyle), null); }
  stroke() { this.capture(colorOf(this.strokeStyle), this.lineWidth); }
}

const staticValue = <T,>(k: T) => ({ a: 0 as const, k });

function buildLayer(marks: Mark[], index: number, frames: number) {
  const first = marks[0];
  const path = JSON.stringify(first.path);
  const shape = marks.every(item => JSON.stringify(item.path) === path) ?
    staticValue(first.path) :
    { a: 1 as const, k: marks.map(({path}, t) => ({ t, s: [path], h: 1 as const })) };
  const appearance = first.width === null ?
    { ty: "fl" as const, c: staticValue(first.color), o: staticValue(100), r: 1 } :
    { ty: "st" as const, c: staticValue(first.color), o: staticValue(100), w: staticValue(first.width), lc: 1, lj: 1 };
  return {
    ty: 4 as const, ind: index + 1, nm: "Path " + (index + 1), sr: 1, ip: 0, op: frames, st: 0, bm: 0,
    ks: { o: staticValue(100), r: staticValue(0), p: staticValue([0, 0, 0]), a: staticValue([0, 0, 0]), s: staticValue([100, 100, 100]) },
    shapes: [{ ty: "sh" as const, ks: shape, nm: "Path" }, appearance],
  };
}

export function compileLottie(snapshot: ExportSnapshot) {
  const paths: Mark[][] = [];
  let frames = 0;
  for (const frame of sampleExportFrames(snapshot)) {
    const context = new VectorCapture();
    drawArtboardBackground(context, frame.rig);
    drawRigArtwork(context, frame.rig, frame.poses, frame.phase);
    if (frames === 0) {
      context.marks.forEach(mark => paths.push([mark]));
    } else {
      if (context.marks.length !== paths.length) throw new Error("Lottie path topology changed across frames.");
      context.marks.forEach((mark, index) => {
        if (mark.path.v.length !== paths[index][0].path.v.length) throw new Error("Lottie vertex topology changed across frames.");
        paths[index].push(mark);
      });
    }
    frames++;
  }
  const artboard = artboardFor(snapshot.rig);
  return {
    v: "5.12.2", fr: snapshot.fps, ip: 0, op: frames, w: artboard.width, h: artboard.height,
    nm: snapshot.name, ddd: 0, assets: [],
    layers: paths.map((marks, index) => buildLayer(marks,index,frames)).reverse(),
  };
}
