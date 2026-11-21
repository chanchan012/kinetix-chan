import { z } from "zod";

const position=z.object({x:z.number().min(-32768).max(32768),y:z.number().min(-32768).max(32768)});
const label=z.string().min(1).max(80);
export const spriteLoopMode=z.enum(["once","repeat","ping-pong"]);
export const spriteCompanionFields={
  startTick:z.int().min(0).max(959999),durationTicks:z.int().min(1).max(10_000),pivot:position,origin:position,
  sockets:z.array(position.extend({name:label,angle:z.number().min(-1000).max(1000)})).max(32),
  collisions:z.array(z.discriminatedUnion("kind",[
    position.extend({kind:z.literal("rect"),name:label,width:z.number().gt(0).max(32768),height:z.number().gt(0).max(32768)}),
    z.object({kind:z.literal("polygon"),name:label,points:z.array(position).min(3).max(64)}),
  ])).max(32),
  events:z.array(z.object({
    name:label,tick:z.int().min(0).max(9999),
    data:z.record(z.string().min(1).max(40),z.union([z.string().max(256),z.number(),z.boolean(),z.null()])).optional(),
  })).max(32),
};
export const spriteCompanionFrameSchema=z.strictObject(spriteCompanionFields);
export const spriteSourceSchema=z.strictObject({
  clipId:z.uuid(),originalClipId:z.uuid(),sourceScale:z.int().min(1).max(4),direction:label.optional(),loopMode:spriteLoopMode,
  frames:z.array(spriteCompanionFrameSchema).min(1).max(96),
});
export const spriteSourcesSchema=z.array(spriteSourceSchema).max(128).superRefine((sources,ctx)=>{
  const ids=new Set<string>();
  for (const source of sources) {
    let tick=0;
    const invalid=source.frames.some(frame=>{
      const valid=frame.startTick===tick && frame.events.every(event=>event.tick<frame.durationTicks);
      tick+=frame.durationTicks;
      return !valid;
    });
    if (invalid || ids.has(source.clipId) || tick>36000) {
      ctx.addIssue({code:"custom",message:"Imported sprite sources must have unique clips and contiguous timing within the clip limit."});
    }
    ids.add(source.clipId);
  }
  if (new TextEncoder().encode(JSON.stringify(sources)).length>512*1024) {
    ctx.addIssue({code:"custom",message:"The document supports up to 512 KiB of sprite metadata."});
  }
});

export type SpriteSource=z.infer<typeof spriteSourceSchema>;
export type SpriteCompanionFrame=z.infer<typeof spriteCompanionFrameSchema>;

export function spritePlaybackFrame(source:SpriteSource|undefined,tick:number,length:number) {
  if (source?.loopMode==="once") return Math.min(tick,length-1);
  if (source?.loopMode==="ping-pong" && source.frames.length>=3) {
    const first=source.frames[0].durationTicks;
    const last=source.frames.findLast(frame=>frame.startTick<length)?.startTick ?? 0;
    const reverse=Math.max(0,last-first);
    const time=tick%(length+reverse);
    return time<length ? time : last-1-(time-length);
  }
  return tick%length;
}
