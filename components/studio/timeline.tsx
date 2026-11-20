"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Diamond, FilmSlate, Pause, Play } from "@phosphor-icons/react";
import { studyFor } from "@/lib/studies";
import { channelId, removeKey, setKey, setKeyEase, tracksSchema, type Channel, type Track } from "@/lib/rig/animation";
import { referenceFrameCount, type KinetixRigState } from "@/lib/rig/model";
import { EasingGraph } from "./easing-graph";
import type { Selection } from "./viewport";
import { useStudioShortcuts } from "./shortcuts";

export type ClipTiming = { id: string; name: string; fps: number; frameCount: number; tracks: Track[]; trackRevision: number };
export type FramePreview = { frame: number; frames: number; tracks: readonly Track[]; onion: boolean };
type Draft = { clip: ClipTiming; tracks: Track[]; conflict: boolean };
const emptyTracks: Track[] = [];
const degrees = 180 / Math.PI;

export function Timeline({clips, clipId, selectClip, manageClips, rigId, rig, selected, select, preview, onDirty, onClip}: {
  clips: ClipTiming[]; rigId: string; rig: KinetixRigState; selected: Selection;
  clipId: string; selectClip: (id: string) => void; manageClips: () => void;
  select: (selection: Selection) => void;
  preview: (frame: FramePreview) => void; onDirty: (value: boolean) => void;
  onClip: (clip: ClipTiming | undefined) => void;
}) {
  const source = rig.study ? studyFor(rig.study) : null;
  const [previousClipId, setPreviousClipId] = useState(clipId);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [onion, setOnion] = useState(false);
  const [basePose, setBasePose] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [channelKey, setChannelKey] = useState("");
  const [graphOpen, setGraphOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  if (clipId !== previousClipId) {
    setPreviousClipId(clipId);
    setPlaying(false);
    setGraphOpen(false);
    setError("");
    setFrame(0);
  }
  const locked = useRef(false);
  const valueInput = useRef<HTMLInputElement>(null);
  const savedClip = clips.find(item => item.id === clipId);
  const local = drafts[clipId];
  const draft = local && (local.tracks !== local.clip.tracks ||
    (savedClip && local.clip.trackRevision >= savedClip.trackRevision)) ? local : undefined;
  const clip = draft?.clip ?? savedClip;
  const tracks = draft?.tracks ?? clip?.tracks ?? emptyTracks;
  const dirty = draft && draft.tracks !== draft.clip.tracks;
  const fps = clip?.fps ?? 24;
  const frames = clip?.frameCount ?? referenceFrameCount(rig);
  const current = Math.min(frame, frames - 1);

  const bone = selected?.kind === "bone" ? rig.bones.find(item => item.id === selected.id) : undefined;
  const ik = bone && rig.constraints.find(item => [item.upperId, item.lowerId].includes(bone.id));
  const options: { channel: Channel; label: string; value: number }[] = [];
  if (bone) {
    options.push({ channel: { kind: "bone", id: bone.id, property: "rotation" }, label: bone.name + " · Rotation", value: bone.rotation });
    for (const property of ["x","y"] as const) {
      options.push({ channel: { kind: "bone", id: bone.id, property }, label: bone.name + " · " + property.toUpperCase(), value: bone.offset[property] });
      if (ik) options.push({ channel: { kind: "ik", id: ik.id, property }, label: "IK target · " + property.toUpperCase(), value: ik.target[property] });
    }
  }
  const active = options.find(option => channelId(option.channel) === channelKey) ?? options[0];
  const key = active && tracks.find(track => channelId(track.channel) === channelId(active.channel))?.keys.find(item => item.frame === current);
  const keyValue = key?.value ?? active?.value;
  const units = active?.channel.property === "rotation" ? degrees : 1;
  const hasDrafts = Object.values(drafts).some(item => item.tracks !== item.clip.tracks);
  useEffect(() => { onDirty(hasDrafts); }, [hasDrafts, onDirty]);
  useEffect(() => { onClip(clip); }, [clip, onClip]);

  useEffect(() => {
    preview({ frame: current, frames, tracks: basePose ? emptyTracks : tracks, onion });
  }, [current, frames, tracks, basePose, onion, preview]);

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

  function change(next: Track[]) {
    if (!clip) return;
    if (!tracksSchema.safeParse(next).success) {
      setError("The clip exceeds its supported keyframe limit.");
      return;
    }
    setError("");
    setDrafts(items => ({ ...items, [clip.id]: { clip, tracks: next, conflict: draft?.conflict ?? false } }));
  }

  async function save(reload = false) {
    if (!clip || locked.current) return;
    locked.current = true;
    setSaving(true);
    setError("");
    try {
      const path = `/api/rigs/${rigId}/clips/${clip.id}/tracks`;
      const response = await fetch(path, reload ? { cache: "no-store" } : {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracks, trackRevision: clip.trackRevision }),
      });
      if (response.status === 409) {
        setDrafts(items => ({ ...items, [clip.id]: { clip, tracks: items[clip.id]?.tracks ?? tracks, conflict: true } }));
        return;
      }
      if (!response.ok) throw new Error("Could not save keys.");
      const result: ClipTiming = await response.json();
      setDrafts(items => ({ ...items, [clip.id]: {
        clip: result, tracks: reload || items[clip.id]?.tracks === tracks ? result.tracks : items[clip.id]?.tracks ?? result.tracks,
        conflict: false,
      } }));
    } catch {
      setError(reload ? "Could not reload keyframes." : "Could not save keyframes. Your edits are still open.");
    } finally {
      locked.current = false;
      setSaving(false);
    }
  }

  const autosave = useEffectEvent(() => { void save(); });
  useEffect(() => {
    if (!dirty || saving || graphOpen || draft?.conflict) return;
    const timer = setTimeout(autosave,error ? 7000 : 1100);
    return () => clearTimeout(timer);
  }, [dirty,saving,graphOpen,draft?.conflict,error,tracks]);

  function insertKey() {
    const value = (valueInput.current?.valueAsNumber ?? NaN) / units;
    if (active && Number.isFinite(value) && Math.abs(value) <= 1_000_000) {
      setPlaying(false);
      setBasePose(false);
      change(setKey(tracks,active.channel,current,value));
    }
  }

  useStudioShortcuts(event => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.code === "Space" &&
        !(event.target instanceof HTMLElement && event.target.closest("button, a, summary"))) {
      event.preventDefault();
      if (!event.repeat) setPlaying(value => !value);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setPlaying(false);
      setFrame(frame => Math.max(0, Math.min(frames - 1, frame + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 5 : 1))));
    } else if (!event.repeat && event.key.toLowerCase() === "o") {
      event.preventDefault();
      setOnion(value => !value);
    } else if (!event.repeat && event.key.toLowerCase() === "k" && clip && active) {
      event.preventDefault();
      insertKey();
    }
  });

  const ticks = Array.from(new Set([1, Math.ceil(frames / 4), Math.ceil(frames / 2), Math.ceil(3 * frames / 4), frames]));
  return <section className="studio-timeline" id="studio-timeline" aria-label="Timeline">
    <div className="studio-timeline-head">
      <h2>Timeline</h2>
      <label><span className="sr-only">Animation clip</span><select value={clip ? clipId : ""} onChange={event => selectClip(event.target.value)}>
        <option value="">{source ? source.clip + " · Study" : "Base pose"}</option>
        {clips.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select></label>
      <button className="studio-toggle studio-manage-clips" onClick={manageClips} disabled={hasDrafts || saving}
        aria-label="Manage clips" title={hasDrafts ? "Save keyframe changes to manage clips" : "Manage clips"}><FilmSlate size={16}/><span>Manage clips</span></button>
      <button className="studio-toggle" title="Onion skin (O)" aria-pressed={onion} onClick={() => setOnion(value => !value)}>Onion skin</button>
      {clip && <button className="studio-toggle" aria-pressed={basePose} onClick={() => setBasePose(value => !value)}>Base pose</button>}
      <span className="studio-fps">{fps} fps</span>
    </div>
    <div className="studio-transport">
      <button aria-label={playing ? "Pause timeline" : "Play timeline"} title="Play or pause (Space)" onClick={() => setPlaying(value => !value)}>
        {playing ? <Pause weight="fill" size={14}/> : <Play weight="fill" size={14}/>}
      </button>
      <output aria-label="Current frame">{current + 1} / {frames}</output>
      <div className="studio-ruler">
        <div aria-hidden="true">{ticks.map(tick => <span key={tick}>{tick}</span>)}</div>
        <input type="range" aria-label="Timeline frame" min={0} max={frames - 1} value={current}
          aria-valuetext={`Frame ${current + 1} of ${frames}`} disabled={frames < 2}
          onChange={event => { setPlaying(false); setFrame(event.target.valueAsNumber); }}/>
      </div>
    </div>
    {clip && <div className="studio-dopesheet" aria-label="Dope sheet">
      <div className="studio-key-tools">
        <label><span className="sr-only">Keyframe channel</span><select disabled={!options.length} value={active ? channelId(active.channel) : ""}
          onChange={event => { setGraphOpen(false); setChannelKey(event.target.value); }}>
          {!options.length && <option value="">Select a bone</option>}
          {options.map(option => <option key={channelId(option.channel)} value={channelId(option.channel)}>{option.label}</option>)}
        </select></label>
        {active && <label><span className="sr-only">Keyframe value</span><input ref={valueInput} type="number" step="any"
          key={channelId(active.channel) + ":" + current + ":" + keyValue} defaultValue={Number((keyValue! * units).toFixed(3))}
          onBlur={event => {
            const value = event.currentTarget.valueAsNumber / units;
            if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) {
              event.currentTarget.value = String(Number((keyValue! * units).toFixed(3)));
            } else if (key && Math.abs(value - key.value) > 0.001 / units) change(setKey(tracks,active.channel,current,value));
          }}/></label>}
        <button title="Insert keyframe (K)" aria-label="Insert keyframe" disabled={!active} onClick={insertKey}><Diamond size={15}/>Key</button>
        <button disabled={!key} onClick={() => { setPlaying(false); setGraphOpen(true); }}>Easing</button>
        <button disabled={!key} onClick={() => { if (active) change(removeKey(tracks,active.channel,current)); }}>Delete key</button>
        <button className="studio-key-save" disabled={!dirty || saving || draft.conflict} onClick={() => void save()}>Save keys</button>
      </div>
      {(error || draft?.conflict) && <p className="studio-key-error" role="alert">{draft?.conflict ?
        <>This clip changed elsewhere. <button disabled={saving} onClick={() => {
          if (window.confirm("Reload saved keyframes and discard local edits?")) void save(true);
        }}>Reload keys</button></> : error}</p>}
      {tracks.length > 0 && <div className="studio-key-tracks">{tracks.map(track => {
        const id = channelId(track.channel);
        const object = rig.bones.find(item => item.id === track.channel.id);
        const label = track.channel.kind === "ik" ? "IK target" : object?.name ?? "Deleted bone";
        return <div className="studio-key-track" key={id}>
          <span>{label} · {track.channel.property}</span>
          <div className="studio-key-lane">{track.keys.map(item => <button key={item.frame}
            aria-label={`${label} ${track.channel.property} keyframe ${item.frame + 1}`}
            aria-pressed={item.frame === current && id === (active && channelId(active.channel))}
            title={`Frame ${item.frame + 1}`} style={{ left: `${item.frame / Math.max(1,frames - 1) * 100}%` }}
            onClick={() => {
              const boneId = track.channel.kind === "bone" ? object?.id :
                rig.constraints.find(constraint => constraint.id === track.channel.id)?.upperId;
              if (boneId) select({ kind: "bone", id: boneId });
              setPlaying(false);
              setFrame(item.frame);
              setChannelKey(id);
            }}><Diamond size={13} weight="fill"/></button>)}</div>
        </div>;
      })}</div>}
    </div>}
    {graphOpen && key && active && <EasingGraph value={key.easing} close={() => setGraphOpen(false)}
      change={value => change(setKeyEase(tracks,active.channel,current,value))}/>}
  </section>;
}
