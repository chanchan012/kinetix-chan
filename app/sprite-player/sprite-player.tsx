"use client";

import { useEffect, useRef, useState } from "react";
import { frameAtTick, forwardFrameStart, openSpriteBundle, restoreSpritePixels, spriteDrawOrigin } from "@/lib/export/sprite-playback";

type Bundle=Awaited<ReturnType<typeof openSpriteBundle>>;
const canvasSize={width:640,height:440};

export function SpritePlayer() {
  const [bundle,setBundle]=useState<Bundle|null>(null);
  const [clipId,setClipId]=useState("");
  const [tick,setTick]=useState(0);
  const [zoom,setZoom]=useState(1);
  const [playing,setPlaying]=useState(false);
  const [showPivot,setShowPivot]=useState(true);
  const [message,setMessage]=useState("");
  const canvas=useRef<HTMLCanvasElement>(null);
  const staging=useRef<HTMLCanvasElement|null>(null);
  const loading=useRef(0);
  const clip=bundle?.manifest.clips.find(item=>item.id===clipId);
  const frame=clip && frameAtTick(clip,tick);
  const frameIndex=clip && frame ? clip.frames.indexOf(frame) : 0;

  async function load(file:File) {
    const request=++loading.current;
    setPlaying(false);
    setMessage("Checking textures…");
    try {
      if (file.size>1_500_000) throw new Error("This sprite ZIP exceeds the player size limit.");
      const next=await openSpriteBundle(new Uint8Array(await file.arrayBuffer()));
      if (loading.current!==request) return;
      setBundle(next);
      setClipId(next.manifest.clips[0].id);
      setTick(0);
      setMessage("");
    } catch (error) {
      if (loading.current===request) setMessage(error instanceof Error ? error.message : "Could not read this ZIP.");
    }
  }

  useEffect(()=>{
    if (!playing || !clip) return;
    const interval=1000/clip.ticksPerSecond;
    let request=0;
    let last=performance.now();
    function advance(now:number) {
      const steps=Math.floor((now-last)/interval);
      if (steps>0) {
        last+=steps*interval;
        setTick(current=>current+steps);
      }
      request=requestAnimationFrame(advance);
    }
    request=requestAnimationFrame(advance);
    return ()=>cancelAnimationFrame(request);
  },[playing,clip]);

  useEffect(()=>{
    if (playing && clip?.loopMode==="once" && tick>=clip.durationTicks-1) setPlaying(false);
  },[playing,clip,tick]);

  useEffect(()=>{
    const target=canvas.current;
    const context=target?.getContext("2d");
    if (!target || !context) return;
    const anchor={x:target.width/2,y:target.height/2};
    context.clearRect(0,0,target.width,target.height);
    if (bundle && frame && !frame.blank) {
      const texture=bundle.textures.get(frame.file)!;
      const {width,height,pixels}=restoreSpritePixels(texture,frame,bundle.manifest.texture);
      const scratch=staging.current ?? (staging.current=document.createElement("canvas"));
      if (scratch.width!==frame.sourceSize.width) scratch.width=frame.sourceSize.width;
      if (scratch.height!==frame.sourceSize.height) scratch.height=frame.sourceSize.height;
      const bitmap=scratch.getContext("2d")!;
      bitmap.clearRect(0,0,scratch.width,scratch.height);
      bitmap.putImageData(new ImageData(pixels,width,height),frame.trimOffset.x,frame.trimOffset.y);
      const scale=zoom/bundle.manifest.source.pixelScale;
      const origin=spriteDrawOrigin(frame,anchor.x,anchor.y,scale);
      context.imageSmoothingEnabled=bundle.manifest.texture.filter==="linear";
      context.drawImage(scratch,origin.x-frame.trimOffset.x*scale,origin.y-frame.trimOffset.y*scale,
        scratch.width*scale,scratch.height*scale);
    }
    if (showPivot) {
      context.strokeStyle="#b84a2e";
      context.beginPath();
      context.moveTo(anchor.x-8,anchor.y+0.5);
      context.lineTo(anchor.x+8,anchor.y+0.5);
      context.moveTo(anchor.x+0.5,anchor.y-8);
      context.lineTo(anchor.x+0.5,anchor.y+8);
      context.stroke();
    }
  },[bundle,frame,showPivot,zoom]);

  return <div className="sprite-player-workspace">
    <section className="sprite-player-stage" aria-label="Sprite stage">
      <canvas ref={canvas} role="img" aria-label="Sprite preview" width={canvasSize.width} height={canvasSize.height}/>
    </section>
    <aside className="sprite-player-controls" aria-label="Playback">
      <label>Portable sprite ZIP<input type="file" accept=".zip,application/zip"
        onChange={event=>{const file=event.target.files?.[0];if (file) void load(file);}}/></label>
      {message && <p role="status">{message}</p>}
      {clip && bundle && frame && <>
        <label>Clip<select value={clip.id} onChange={event=>{setPlaying(false);setClipId(event.target.value);setTick(0);}}>
          {bundle.manifest.clips.map(item=><option key={item.id} value={item.id}>
            {item.name}{item.direction ? " · "+item.direction : ""}
          </option>)}
        </select></label>
        <div className="sprite-player-buttons">
          <button type="button" onClick={()=>{
            if (!playing && clip.loopMode==="once" && tick>=clip.durationTicks-1) setTick(0);
            setPlaying(value=>!value);
          }}>{playing?"Pause":"Play"}</button>
          <button type="button" onClick={()=>{setPlaying(false);setTick(0);}}>Restart</button>
        </div>
        <label>Frame<input type="range" min={0} max={clip.frames.length-1} value={frameIndex}
          onChange={event=>{setPlaying(false);setTick(forwardFrameStart(clip,event.target.valueAsNumber));}}/></label>
        <output aria-label="Current sprite frame">{frame.sourceFrame+1} · {frame.durationTicks} {frame.durationTicks===1?"tick":"ticks"}{frame.blank?" · blank":""}</output>
        <label>Display scale<select value={zoom} onChange={event=>setZoom(Number(event.target.value))}>
          {[0.5,0.75,1,1.25,1.5,2,3,4].map(scale=><option value={scale} key={scale}>{scale}×</option>)}
        </select></label>
        <label className="sprite-player-check"><input type="checkbox" checked={showPivot} onChange={event=>setShowPivot(event.target.checked)}/>Show pivot</label>
        <dl>
          <dt>Sample rate</dt><dd>{clip.ticksPerSecond} ticks/s</dd>
          <dt>Texture</dt><dd>{bundle.manifest.texture.filter}</dd>
          <dt>Frame pivot</dt><dd>{frame.pivot.x}, {frame.pivot.y}</dd>
        </dl>
        {frame.events.length>0 && <p>Events · {frame.events.map(event=>event.name).join(", ")}</p>}
      </>}
    </aside>
  </div>;
}
