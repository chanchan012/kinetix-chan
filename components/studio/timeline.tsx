"use client";

import { useEffect, useState } from "react";
import { Pause, Play } from "@phosphor-icons/react";
import { studyFor, type Study } from "@/lib/studies";

export type ClipTiming = { id: string; name: string; fps: number; frameCount: number };

export function Timeline({clips, study, setPhase}: {
  clips: ClipTiming[]; study: Study["id"]; setPhase: (phase: number) => void;
}) {
  const source = studyFor(study);
  const [clipId, setClipId] = useState(clips[0]?.id ?? "");
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const clip = clips.find(item => item.id === clipId);
  const fps = clip?.fps ?? 24;
  const frames = clip?.frameCount ?? source.frames;

  useEffect(() => {
    setPhase(frame / frames);
  }, [frame, frames, setPhase]);

  useEffect(() => {
    if (!playing) return;
    let animation = 0;
    let last = performance.now();
    function tick(time: number) {
      const count = Math.floor((time - last) * fps / 1000);
      if (count > 0) {
        last += count * 1000 / fps;
        setFrame(previous => (previous + count) % frames);
      }
      animation = requestAnimationFrame(tick);
    }
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [playing, fps, frames]);

  const ticks = Array.from(new Set([1, Math.ceil(frames / 4), Math.ceil(frames / 2), Math.ceil(3 * frames / 4), frames]));
  return <section className="studio-timeline" aria-label="Timeline">
    <div className="studio-timeline-head">
      <h2>Timeline</h2>
      <label><span className="sr-only">Animation clip</span><select value={clipId} onChange={event => {
        setPlaying(false);
        setFrame(0);
        setClipId(event.target.value);
      }}>
        <option value="">{source.clip} · Study</option>
        {clips.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select></label>
      <span className="studio-fps">{fps} fps</span>
    </div>
    <div className="studio-transport">
      <button aria-label={playing ? "Pause timeline" : "Play timeline"} onClick={() => setPlaying(value => !value)}>
        {playing ? <Pause weight="fill" size={14}/> : <Play weight="fill" size={14}/>}
      </button>
      <output aria-label="Current frame">{frame + 1} / {frames}</output>
      <div className="studio-ruler">
        <div aria-hidden="true">{ticks.map(tick => <span key={tick}>{tick}</span>)}</div>
        <input type="range" aria-label="Timeline frame" min={0} max={frames - 1} value={frame}
          aria-valuetext={`Frame ${frame + 1} of ${frames}`} disabled={frames < 2}
          onChange={event => { setPlaying(false); setFrame(event.target.valueAsNumber); }}/>
      </div>
    </div>
  </section>;
}
