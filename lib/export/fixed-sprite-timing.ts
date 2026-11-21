import { spritePlaybackVisits, type PlaybackClip, type PlaybackFrame } from "./sprite-playback";

export type FixedSourceFrame = Pick<PlaybackFrame,
  "id"|"sourceFrame"|"startTick"|"durationTicks"|"pivot"|"origin"|"sockets"|"collisions"|"events">;
export type FixedSourceClip = Omit<PlaybackClip,"frames"> & {frames:FixedSourceFrame[]};

export function planFixedSpriteTiming(clip:FixedSourceClip,fps:number) {
  const visits=spritePlaybackVisits(clip.frames,clip.loopMode);
  const sourceLoopTicks=visits.reduce((sum,frame)=>sum+frame.durationTicks,0);
  const rounded=(tick:number)=>Math.round(tick*fps/clip.ticksPerSecond);
  const totalFrames=Math.max(1,rounded(sourceLoopTicks));
  const elapsedMs=(frames:number,ticks:number)=>(frames*clip.ticksPerSecond-ticks*fps)*1000/(fps*clip.ticksPerSecond);
  const boundary=(tick:number)=>tick>0 && rounded(sourceLoopTicks)===0 ? 1 : rounded(tick);
  let sourceTick=0;
  let maxBoundaryErrorMs=0;
  const runs=visits.map(frame=>{
    const start=sourceTick;
    sourceTick+=frame.durationTicks;
    const outputStart=boundary(start);
    const outputEnd=boundary(sourceTick);
    maxBoundaryErrorMs=Math.max(maxBoundaryErrorMs,Math.abs(elapsedMs(outputEnd,sourceTick)));
    return {frameId:frame.id,sourceTick:start,outputStart,frameCount:outputEnd-outputStart};
  });
  const cues=visits.flatMap((frame,index)=>frame.events.toSorted((a,b)=>a.tick-b.tick).map(cue=>{
    const sourceTick=runs[index].sourceTick+cue.tick;
    const outputFrame=Math.min(totalFrames-1,rounded(sourceTick));
    return {frameId:frame.id,sourceTick,outputFrame,name:cue.name,data:cue.data,errorMs:elapsedMs(outputFrame,sourceTick)};
  }));
  return {
    sourceLoopTicks,totalFrames,runs,cues,
    droppedVisits:runs.filter(run=>!run.frameCount).length,
    durationErrorMs:elapsedMs(totalFrames,sourceLoopTicks),maxBoundaryErrorMs,
    maxCueErrorMs:cues.reduce((max,cue)=>Math.max(max,Math.abs(cue.errorMs)),0),
  };
}
