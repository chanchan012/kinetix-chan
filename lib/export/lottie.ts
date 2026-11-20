import { drawArtboardBackground, drawRigArtwork, type RigDrawingContext } from "../rig/render";
import { sampleExportFrames, type ExportSnapshot } from "./frames";
import { artboardFor } from "../rig/model";

type Vec = [number, number];
type Color = [number, number, number];
type Matrix = [number, number, number, number, number, number];
type Shape = { i: Vec[]; o: Vec[]; v: Vec[]; c: boolean };
type Gradient = { from:Vec;to:Vec;stops:{offset:number;color:Color}[];addColorStop(offset:number,color:string):void };
type StrokeStyle = { width:number;cap:CanvasLineCap;join:CanvasLineJoin;miter:number;dash:number[];offset:number };
type Mark = { paths:Shape[];paint:Color|Gradient;opacity:number;rule:CanvasFillRule;stroke:StrokeStyle|null;mask:Shape[]|null };
type GraphicsState = { matrix:Matrix;fill:unknown;stroke:unknown;strokeStyle:StrokeStyle;alpha:number;mask:Shape[]|null };

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

function paintOf(style:unknown):Color|Gradient {
  return typeof style==="object" && style!==null && "stops" in style ? style as Gradient : colorOf(style);
}

/** Capture the subset of Canvas commands used by rig artwork, resolving transforms to artboard coordinates. */
class VectorCapture implements RigDrawingContext {
  fillStyle: unknown = "#000000";
  strokeStyle: unknown = "#000000";
  lineWidth = 1;
  globalAlpha = 1;
  lineCap:CanvasLineCap = "butt";
  lineJoin:CanvasLineJoin = "miter";
  miterLimit = 10;
  lineDashOffset = 0;
  readonly marks: Mark[] = [];
  private matrix = identity;
  private readonly stack: GraphicsState[] = [];
  private paths: Shape[] = [];
  private current: Shape | undefined;
  private dash:number[] = [];
  private mask:Shape[]|null = null;

  private point(x: number, y: number): Vec {
    const [a, b, c, d, e, f] = this.matrix;
    return [rounded(x * a + y * c + e), rounded(x * b + y * d + f)];
  }

  save() {
    this.stack.push({matrix:this.matrix,fill:this.fillStyle,stroke:this.strokeStyle,strokeStyle:this.strokeValues(),
      alpha:this.globalAlpha,mask:this.mask});
  }
  restore() {
    const state = this.stack.pop();
    if (!state) return;
    this.matrix = state.matrix;
    this.fillStyle = state.fill;
    this.strokeStyle = state.stroke;
    this.lineWidth = state.strokeStyle.width;
    this.lineCap = state.strokeStyle.cap;
    this.lineJoin = state.strokeStyle.join;
    this.miterLimit = state.strokeStyle.miter;
    this.lineDashOffset = state.strokeStyle.offset;
    this.dash = state.strokeStyle.dash;
    this.globalAlpha = state.alpha;
    this.mask = state.mask;
  }
  translate(x: number, y: number) {
    this.transform(1,0,0,1,x,y);
  }
  transform(aa:number,bb:number,cc:number,dd:number,ee:number,ff:number) {
    const [a, b, c, d, e, f] = this.matrix;
    this.matrix = [
      aa*a+bb*c,aa*b+bb*d,cc*a+dd*c,cc*b+dd*d,ee*a+ff*c+e,ee*b+ff*d+f,
    ];
  }
  rotate(angle: number) {
    const sine = Math.sin(angle);
    const cosine = Math.cos(angle);
    this.transform(cosine,sine,-sine,cosine,0,0);
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
  createLinearGradient(x0:number,y0:number,x1:number,y1:number):Gradient {
    const stops:Gradient["stops"] = [];
    return {from:this.point(x0,y0),to:this.point(x1,y1),stops,
      addColorStop:(offset,color)=>stops.push({offset,color:colorOf(color)})};
  }
  setLineDash(dash:number[]) { this.dash = dash.length%2 ? [...dash,...dash] : [...dash]; }
  clip() { this.mask = this.paths.filter(path=>path.v.length>=3); }
  private strokeValues():StrokeStyle {
    return {width:this.lineWidth,cap:this.lineCap,join:this.lineJoin,miter:this.miterLimit,dash:this.dash,offset:this.lineDashOffset};
  }
  private capture(paint:Color|Gradient,rule:CanvasFillRule,stroke:StrokeStyle|null) {
    const paths = this.paths.filter(path=>path.v.length>=2);
    if (paths.length) this.marks.push({paths,paint,opacity:this.globalAlpha*100,rule,stroke,mask:this.mask});
  }
  fill(rule:CanvasFillRule = "nonzero") { this.capture(paintOf(this.fillStyle),rule,null); }
  stroke() { this.capture(paintOf(this.strokeStyle),"nonzero",this.strokeValues()); }
}

const staticValue = <T,>(k: T) => ({ a: 0 as const, k });
const changes = <T,>(values:T[]) => {
  const first=JSON.stringify(values[0]);
  return !values.every(value=>JSON.stringify(value)===first);
};
function pathValue(paths:Shape[]) {
  return changes(paths) ? {a:1 as const,k:paths.map((path,t)=>({t,s:[path],h:1 as const}))} : staticValue(paths[0]);
}
function sampleValue<T extends number|number[]>(samples:T[]) {
  return changes(samples) ? {a:1 as const,k:samples.map((s,t)=>({t,s:Array.isArray(s)?s:[s],h:1 as const}))} : staticValue(samples[0]);
}
function direction(path:Shape) {
  return Math.sign(path.v.reduce((value,point,i)=>{
    const next=path.v[(i+1)%path.v.length];
    return value+point[0]*next[1]-next[0]*point[1];
  },0));
}

function buildLayer(marks: Mark[], index: number, frames: number) {
  const first = marks[0];
  const gradient = !Array.isArray(first.paint);
  const ink = gradient ? {
    t:1,g:{p:(first.paint as Gradient).stops.length,
      k:sampleValue(marks.map(mark=>(mark.paint as Gradient).stops.flatMap(stop=>[stop.offset,...stop.color])))},
    s:sampleValue(marks.map(mark=>(mark.paint as Gradient).from)),
    e:sampleValue(marks.map(mark=>(mark.paint as Gradient).to)),
  } : {c:sampleValue(marks.map(mark=>mark.paint as Color))};
  const opacity = sampleValue(marks.map(mark=>mark.opacity));
  const stroke = first.stroke;
  const appearance = stroke ? {
    ty:gradient?"gs":"st",...ink,o:opacity,w:sampleValue(marks.map(mark=>mark.stroke!.width)),
    lc:{butt:1,round:2,square:3}[stroke.cap],lj:{miter:1,round:2,bevel:3}[stroke.join],ml:stroke.miter,
    ...(stroke.dash.length && {d:[
      ...stroke.dash.map((size,i)=>({n:i%2?"g":"d",v:staticValue(size)})),{n:"o",v:staticValue(stroke.offset)},
    ]}),
  } : {ty:gradient?"gf":"fl",...ink,o:opacity,r:first.rule==="evenodd"?2:1};
  const masks = first.mask?.map((path,i)=>({
    mode:direction(path)===direction(first.mask![0]) ? "a" : "s",
    inv:false,o:staticValue(100),x:staticValue(0),pt:pathValue(marks.map(mark=>mark.mask![i])),
  }));
  return {
    ty: 4 as const, ind: index + 1, nm: "Path " + (index + 1), sr: 1, ip: 0, op: frames, st: 0, bm: 0,
    ks: { o: staticValue(first.mask?.length===0?0:100), r: staticValue(0), p: staticValue([0, 0, 0]), a: staticValue([0, 0, 0]), s: staticValue([100, 100, 100]) },
    ...(masks?.length && {hasMask:true,masksProperties:masks}),
    shapes: [...first.paths.map((_,i)=>({ty:"sh" as const,ks:pathValue(marks.map(mark=>mark.paths[i])),nm:"Path"})),appearance],
  };
}

export function compileLottie(snapshot: ExportSnapshot) {
  const paths: Mark[][] = [];
  let frames = 0;
  for (const frame of sampleExportFrames(snapshot)) {
    const context = new VectorCapture();
    drawArtboardBackground(context, frame.rig);
    drawRigArtwork(context,frame.rig,frame.poses,frame.phase,true,null,{
      sample:frame.sample,paint:(_drawing,cel)=>{
        if (cel.runs.length) throw new Error("Raster cels require a PNG, sprite or video export.");
      },
    });
    if (frames === 0) {
      context.marks.forEach(mark => paths.push([mark]));
    } else {
      if (context.marks.length !== paths.length) throw new Error("Lottie path topology changed across frames.");
      context.marks.forEach((mark, index) => {
        const first = paths[index][0];
        const shapeCounts = (shapes:Shape[]|null)=>shapes?.map(path=>path.v.length).join(",");
        if (shapeCounts(mark.paths)!==shapeCounts(first.paths) || shapeCounts(mark.mask)!==shapeCounts(first.mask)) {
          throw new Error("Lottie vertex or mask topology changed across frames.");
        }
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
