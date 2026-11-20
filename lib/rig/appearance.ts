import { z } from "zod";
import type { Point, VectorPart } from "./model";
import type { BonePose } from "./kinematics";
import { partWorldSpace } from "./part-transform";

const rgb = z.string().regex(/^#[0-9a-f]{6}$/i);
const coordinate = z.number().min(-1_000_000).max(1_000_000);
const point = z.strictObject({x:coordinate,y:coordinate});
const stop = z.strictObject({offset:z.number().min(0).max(1),color:rgb});
const linear = z.strictObject({kind:z.literal("linear"),from:point,to:point,stops:z.array(stop).min(2).max(16)})
  .superRefine(({from,to,stops},ctx)=>{
    if (Math.hypot(to.x-from.x,to.y-from.y)<0.001) ctx.addIssue({code:"custom",path:["to"],message:"Gradient endpoints need separation."});
    if (stops.some((entry,i)=>i>0 && entry.offset<stops[i-1].offset)) {
      ctx.addIssue({code:"custom",path:["stops"],message:"Stops must be in drawing order."});
    }
  });
const solid = z.strictObject({kind:z.literal("solid"),color:rgb});
const swatchId = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
const swatch = z.strictObject({kind:z.literal("swatch"),id:swatchId});
export const paintValueSchema = z.discriminatedUnion("kind",[solid,linear]);
export const paintSchema = z.discriminatedUnion("kind",[solid,linear,swatch]);
export const swatchSchema = z.strictObject({id:swatchId,name:z.string().trim().min(1).max(120),paint:paintValueSchema});
export const appearanceSchema = z.strictObject({
  fill:paintSchema.nullable().optional(),
  opacity:z.number().min(0).max(1).optional(),
  stroke:z.strictObject({
    paint:paintSchema,width:z.number().gt(0).max(512),cap:z.enum(["butt","round","square"]),
    join:z.enum(["miter","round","bevel"]),miter:z.number().min(1).max(64),
    dash:z.array(z.number().gt(0).max(2048)).max(16),
    offset:z.number().min(-2048).max(2048).optional(),
  }).nullable().optional(),
});

export type PaintValue = z.infer<typeof paintValueSchema>;
export type Paint = z.infer<typeof paintSchema>;
export type Swatch = z.infer<typeof swatchSchema>;
export type Appearance = z.infer<typeof appearanceSchema>;
export type Stroke = NonNullable<Appearance["stroke"]>;

export function resolvePaint(paint:Paint,swatches:readonly Swatch[]):PaintValue {
  if (paint.kind!=="swatch") return paint;
  const resolved = swatches.find(entry=>entry.id===paint.id);
  if (!resolved) throw new Error("A linked swatch could not be found.");
  return resolved.paint;
}

export function defaultStroke(color:string):Stroke {
  return {paint:{kind:"solid",color},width:2,cap:"butt",join:"miter",miter:10,dash:[]};
}

/** Transform a linear gradient as a covector so reflections and nonuniform scale preserve its colors. */
export function gradientAxis(part:VectorPart,paint:Extract<PaintValue,{kind:"linear"}>,poses:Map<string,BonePose>):[Point,Point] {
  const origin = partWorldSpace({x:0,y:0},part,poses);
  const x = partWorldSpace({x:1,y:0},part,poses);
  const y = partWorldSpace({x:0,y:1},part,poses);
  const [a,b,c,d] = [x.x-origin.x,x.y-origin.y,y.x-origin.x,y.y-origin.y];
  const determinant = a*d-b*c;
  const dx = paint.to.x-paint.from.x;
  const dy = paint.to.y-paint.from.y;
  const gx = (d*dx-b*dy)/determinant;
  const gy = (a*dy-c*dx)/determinant;
  const length = (dx*dx+dy*dy)/(gx*gx+gy*gy);
  const from = partWorldSpace(paint.from,part,poses);
  return [from,{x:from.x+gx*length,y:from.y+gy*length}];
}
