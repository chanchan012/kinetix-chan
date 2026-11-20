import { z } from "zod";

export const drawingIdSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
export const drawingFrameSchema = z.int().min(0).max(35_999);
const dimension = z.int().min(1).max(4096);
const pixel = z.int().min(0).max(4095);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);

// Each run is [row, left, width, ink]. Transparent pixels are represented by gaps.
const runSchema = z.tuple([pixel,pixel,dimension,z.int().min(1).max(0xffffffff)]);
export const celRunsSchema = z.array(runSchema).max(40_000);
export const celSchema = z.strictObject({id:drawingIdSchema,runs:celRunsSchema});
export const exposureSchema = z.strictObject({frame:drawingFrameSchema,celId:drawingIdSchema.nullable()});
const exposureTrack = z.strictObject({clipId:z.uuid(),keys:z.array(exposureSchema).min(1).max(10_000)});
export const drawingStorageSchema = z.discriminatedUnion("mode",[
  z.strictObject({mode:z.literal("rgba")}),
  z.strictObject({mode:z.literal("indexed"),colors:z.array(color).min(1).max(256)}),
]);

export const drawingInputSchema = z.strictObject({
  id:drawingIdSchema,
  name:z.string().trim().min(1).max(120),
  width:dimension,
  height:dimension,
  storage:drawingStorageSchema,
});
export const drawingSchema = drawingInputSchema.extend({
  cels:z.array(celSchema).max(512),
  restCelId:drawingIdSchema.nullable(),
  tracks:z.array(exposureTrack).max(256),
}).superRefine((drawing,context)=>{
  const ids = new Set(drawing.cels.map(cel=>cel.id));
  if (ids.size!==drawing.cels.length) context.addIssue({
    code:"custom",path:["cels"],message:"Cel IDs must be unique within the drawing.",
  });
  if (drawing.restCelId!==null && !ids.has(drawing.restCelId)) context.addIssue({
    code:"custom",path:["restCelId"],message:"Choose a cel from this drawing.",
  });
  const tracks = new Set<string>();
  for (const [index,track] of drawing.tracks.entries()) {
    if (tracks.has(track.clipId) || track.keys.some((key,i)=>
      (key.celId!==null && !ids.has(key.celId)) || (i>0 && key.frame<=track.keys[i-1].frame))) {
      context.addIssue({code:"custom",path:["tracks",index],
        message:"Use one track per clip with ascending exposures that reference this drawing."});
    }
    tracks.add(track.clipId);
  }
  for (const [index,cel] of drawing.cels.entries()) {
    let previous:CelRun|undefined;
    for (const run of cel.runs) {
      const [y,x,length,ink] = run;
      const overlap = previous && (previous[0]>y || (previous[0]===y && previous[1]+previous[2]>x));
      const unmerged = previous && previous[0]===y && previous[1]+previous[2]===x && previous[3]===ink;
      if (x+length>drawing.width || y>=drawing.height || overlap || unmerged || ink%256===0 ||
          (drawing.storage.mode==="indexed" && Math.floor(ink/256)>=drawing.storage.colors.length)) {
        context.addIssue({code:"custom",path:["cels",index,"runs"],
          message:"Cel runs must be in bounds, sorted, merged, visible and use available ink."});
        break;
      }
      previous=run;
    }
  }
});

export const drawingsSchema = z.strictObject({
  version:z.literal(1),
  layers:z.array(drawingSchema).max(32),
}).superRefine(({layers},context)=>{
  if (new Set(layers.map(layer=>layer.id)).size!==layers.length) {
    context.addIssue({code:"custom",path:["layers"],message:"Drawing IDs must be unique."});
  }
  let runs=0;
  let exposures=0;
  for (const layer of layers) {
    for (const cel of layer.cels) runs+=cel.runs.length;
    for (const track of layer.tracks) exposures+=track.keys.length;
  }
  if (runs>100_000 || exposures>10_000) context.addIssue({code:"custom",path:["layers"],
    message:"A document supports up to 100,000 pixel runs and 10,000 cel exposures."});
});

export type Drawing = z.infer<typeof drawingSchema>;
export type Cel = z.infer<typeof celSchema>;
export type CelRun = z.infer<typeof runSchema>;
export type Exposure = z.infer<typeof exposureSchema>;
export type DrawingSample = {clipId?:string|null;frame:number};

export function exposureAt(drawing:Drawing,{clipId,frame}:DrawingSample):string|null {
  const keys = drawing.tracks.find(track=>track.clipId===clipId)?.keys;
  if (!keys) return drawing.restCelId;
  let low=0;
  let high=keys.length;
  while (low<high) {
    const middle = Math.floor((low+high)/2);
    if (keys[middle].frame<=frame) low=middle+1;
    else high=middle;
  }
  return low===0 ? drawing.restCelId : keys[low-1].celId;
}

export function celAt(drawing:Drawing,sample:DrawingSample):Cel|undefined {
  const id = exposureAt(drawing,sample);
  return drawing.cels.find(cel=>cel.id===id);
}

export function inkAt(runs:readonly CelRun[],x:number,y:number):number {
  let low=0;
  let high=runs.length;
  while (low<high) {
    const middle = Math.floor((low+high)/2);
    const [row,left] = runs[middle];
    if (row<y || (row===y && left<=x)) low=middle+1;
    else high=middle;
  }
  if (low===0) return 0;
  const [row,left,width,ink] = runs[low-1];
  return row===y && x<left+width ? ink : 0;
}

export function rgbaInk(storage:Drawing["storage"],ink:number):number {
  if (!ink || storage.mode==="rgba") return ink;
  return Number.parseInt(storage.colors[Math.floor(ink/256)].slice(1),16)*256 + ink%256;
}

export function paintCelRuns(context:{fillStyle:unknown;fillRect(x:number,y:number,width:number,height:number):void},
  drawing:Drawing,cel:Cel,tint?:string) {
  const styles = new Map<number,string>();
  const tintRgb = tint ? Number.parseInt(tint.slice(1),16) : undefined;
  let previousInk = 0;
  for (const [y,x,width,ink] of cel.runs) {
    if (ink!==previousInk) {
      let style = styles.get(ink);
      if (!style) {
        const packed = rgbaInk(drawing.storage,ink);
        const rgb = tintRgb ?? (packed >>> 8);
        style = "rgba("+[(rgb >>> 16)&255,(rgb >>> 8)&255,rgb&255,(packed&255)/255].join(",")+")";
        styles.set(ink,style);
      }
      context.fillStyle=style;
      previousInk=ink;
    }
    context.fillRect(x,y,width,1);
  }
}
