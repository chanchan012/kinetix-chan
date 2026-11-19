"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useStore } from "zustand";
import { ArrowLeft, ArrowCounterClockwise, ArrowClockwise, Bone as BoneIcon, Cursor, FloppyDisk, PenNib } from "@phosphor-icons/react";
import { createRigStore } from "@/lib/rig/store";
import { evaluateRig, rotatePoint } from "@/lib/rig/kinematics";
import { orderedBones, type Bone, type KinetixRigState, type Point, type VectorKnot, type VectorPart } from "@/lib/rig/model";
import { sampleRig } from "@/lib/rig/animation";
import { bindMesh } from "@/lib/rig/skinning";
import { studyFor } from "@/lib/studies";
import type { RigCommand } from "@/lib/rig/commands";
import { Viewport, type Selection, type Tool, type Brush } from "./viewport";
import { Timeline, type ClipTiming, type FramePreview } from "./timeline";

type Props = {
  actorId: string; rigId: string; name: string; initial: KinetixRigState; revision: number; clips: ClipTiming[];
};
const degrees = 180 / Math.PI;
const tools = [{ id: "select", label: "Select", icon: Cursor }, { id: "bone", label: "Draw bone", icon: BoneIcon },
  { id: "pen", label: "Pen", icon: PenNib }] as const;

export function Studio({actorId, rigId, name, initial, revision: initialRevision, clips}: Props) {
  const [store] = useState(() => createRigStore(initial));
  const rig = useStore(store, state => state.rig);
  const past = useStore(store, state => state.past);
  const future = useStore(store, state => state.future);
  const [saved, setSaved] = useState(rig);
  const [revision, setRevision] = useState(initialRevision);
  const [selected, select] = useState<Selection>(rig.bones[0] ? { kind: "bone", id: rig.bones[0].id } : null);
  const [tool, setTool] = useState<Tool>("select");
  const [pen, setPen] = useState<VectorKnot[]>([]);
  const [showBones, setShowBones] = useState(true);
  const [reference, setReference] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [animation, setAnimation] = useState<FramePreview>({ frame: 0, frames: studyFor(initial.study).frames, tracks: [], onion: false });
  const [timelineDirty, setTimelineDirty] = useState(false);
  const [brush, setBrush] = useState<Brush | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const pending = useRef(false);
  const dirty = saved !== rig;
  const bone = selected?.kind === "bone" ? rig.bones.find(item => item.id === selected.id) : undefined;
  const part = selected?.kind === "part" ? rig.parts.find(item => item.id === selected.id) : undefined;
  const activeBrush = part && brush?.partId === part.id && part.mesh && tool === "select" &&
    part.mesh.bindings.some(binding => binding.id === brush.boneId) ? brush : null;
  const pose = useMemo(() => sampleRig(rig,animation.tracks,animation.frame), [rig,animation]);
  const phase = animation.frame / animation.frames;
  const ghosts = useMemo(() => !animation.onion ? [] : [-1,1].map(offset => {
    const frame = Math.min(animation.frames - 1, Math.max(0, animation.frame + offset));
    return { rig: sampleRig(rig,animation.tracks,frame), phase: frame / animation.frames, frame };
  }).filter(ghost => ghost.frame !== animation.frame), [rig,animation]);
  const last = past.at(-1);
  const path = "/api/rigs/" + rigId + "/state";

  function edit(label: string, ...commands: RigCommand[]) {
    try {
      store.getState().dispatch(label, { kind: "human", id: actorId }, ...commands);
      setError("");
      return true;
    } catch {
      setError("The edit would create an invalid rig.");
      return false;
    }
  }

  async function save(reload = false) {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(path, reload ? { cache: "no-store" } : {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision, state: rig }),
      });
      if (response.status === 401) {
        window.location.assign("/sign-in?redirect_url=" + encodeURIComponent(window.location.pathname));
        return;
      }
      if (response.status === 409) {
        setConflict(true);
        return;
      }
      if (!response.ok) throw new Error("Save failed");
      const next: { revision: number; state: KinetixRigState } = await response.json();
      if (reload) store.getState().reset(next.state);
      setSaved(reload ? store.getState().rig : rig);
      setRevision(next.revision);
      setConflict(false);
    } catch {
      setError(reload ? "Could not reload the saved rig." : "Could not save. Your edits are still in the studio.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!dirty && !timelineDirty) return;
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty,timelineDirty]);

  function addBone(from: Point, to: Point) {
    const parent = bone ? evaluateRig(rig).get(bone.id) : undefined;
    const snapped = parent && bone && Math.hypot(from.x - parent.tip.x, from.y - parent.tip.y) < 16;
    const origin = snapped ? parent.tip : from;
    const start = snapped ? { x: bone.length, y: 0 } :
      parent ? rotatePoint({ x: from.x - parent.origin.x, y: from.y - parent.origin.y }, -parent.angle) : from;
    const id = crypto.randomUUID();
    const length = Math.hypot(to.x - origin.x, to.y - origin.y);
    if (length < 0.01) return;
    const rotation = Math.atan2(to.y - origin.y, to.x - origin.x) - (parent?.angle ?? 0);
    if (edit("Add bone", { type: "bone.create", bone: {
      id, parentId: bone?.id ?? null, name: "Bone " + (rig.bones.length + 1), offset: start, length, rotation,
    } })) {
      select({ kind: "bone", id });
      setTool("select");
    }
  }

  function finishPath(closed: boolean) {
    if (pen.length < (closed ? 3 : 2)) return;
    const id = crypto.randomUUID();
    const parent = bone ? evaluateRig(rig).get(bone.id) : undefined;
    const toLocal = (point: Point) => parent ?
      rotatePoint({ x: point.x - parent.origin.x, y: point.y - parent.origin.y }, -parent.angle) : point;
    const knots = pen.map(knot => ({
      point: toLocal(knot.point),
      incoming: knot.incoming && toLocal(knot.incoming),
      outgoing: knot.outgoing && toLocal(knot.outgoing),
    }));
    if (edit("Draw path", { type: "part.create", part: {
      id, parentId: bone?.id ?? null, name: "Path " + (rig.parts.length + 1), offset: { x: 0, y: 0 },
      knots, fill: "#b54b2b", closed,
    } })) {
      select({ kind: "part", id });
      setPen([]);
      setTool("select");
    }
  }

  function keyDown(event: React.KeyboardEvent) {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (dirty && !conflict) void save();
    }
    if ((event.target as HTMLElement).closest("input,textarea,select")) return;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) store.getState().redo();
      else store.getState().undo();
    }
    if (event.key === "Escape") {
      setPen([]);
      setTool("select");
    }
  }

  return <main className="app-shell studio-shell" onKeyDown={keyDown}>
    <header className="studio-header">
      <Link href="/dashboard" className="studio-back" aria-label="Rig library" onClick={event => {
        if ((dirty || timelineDirty) && !window.confirm("Leave the studio with unsaved edits?")) event.preventDefault();
      }}><ArrowLeft size={17}/><span>Library</span></Link>
      <h1>{name}</h1>
      <span role="status" className="studio-save-status">{conflict ? "Save conflict" : saving ? "Saving…" : dirty ? "Unsaved" : timelineDirty ? "Unsaved keys" : "Saved"}</span>
      <button className="studio-save" disabled={!dirty || saving || conflict} onClick={() => void save()}><FloppyDisk size={16}/>Save</button>
    </header>

    {(error || conflict) && <aside className="studio-alert" role="alert">
      {conflict ? <>This rig changed elsewhere. <button disabled={saving} onClick={() => {
        if (window.confirm("Reload the saved rig and discard local changes?")) void save(true);
      }}>Reload saved rig</button></> : error}
    </aside>}

    <div className="studio-grid">
      <aside className="studio-hierarchy" aria-label="Rig hierarchy">
        <div className="studio-panel-title"><h2>Hierarchy</h2><span>{rig.bones.length} bones</span></div>
        <Hierarchy rig={rig} selected={selected} select={select}/>
      </aside>
      <section className="studio-stage" aria-label="Viewport">
        <div className="studio-tools">
          <div className="studio-tool-group" aria-label="Canvas tools">
            {tools.map(({id, label, icon: Icon}) => <button key={id} aria-label={label} title={label}
              aria-pressed={tool === id} onClick={() => {
                if (id !== "pen") setPen([]);
                if (id === "bone") setShowBones(true);
                setTool(id);
              }}><Icon size={16}/><span>{label}</span></button>)}
          </div>
          <div className="studio-tool-group" aria-label="Command history">
            <button title="Undo" aria-label="Undo" disabled={!past.length} onClick={store.getState().undo}><ArrowCounterClockwise size={17}/></button>
            <button title="Redo" aria-label="Redo" disabled={!future.length} onClick={store.getState().redo}><ArrowClockwise size={17}/></button>
          </div>
        </div>
        <div className="studio-artboard"><Viewport rig={pose} brush={activeBrush} ghosts={ghosts}
          {...{ phase, selected, select, tool, reference, zoom, showBones, pen, addBone, edit }}
          addKnot={knot => setPen(knots => knots.length < 256 ? [...knots, knot] : knots)}/></div>
        <div className="studio-stage-footer">
          {tool === "pen" ? <div className="studio-tool-group">
            <button disabled={pen.length < 2} onClick={() => finishPath(false)}>Finish path</button>
            <button disabled={pen.length < 3} onClick={() => finishPath(true)}>Close shape</button>
          </div> : <div className="studio-tool-group">
            <button aria-pressed={showBones} onClick={() => setShowBones(value => !value)}>Bones</button>
            <button aria-pressed={reference} onClick={() => setReference(value => !value)}>Artwork</button>
          </div>}
          <label className="studio-zoom"><span className="sr-only">Zoom</span><select value={zoom} onChange={event => setZoom(Number(event.target.value))}>
            <option value={0.75}>75%</option><option value={1}>Fit</option><option value={1.25}>125%</option><option value={1.5}>150%</option>
          </select></label>
        </div>
      </section>
      <aside className="studio-inspector" aria-label="Inspector">
        <div className="studio-panel-title"><h2>Inspector</h2></div>
        <Inspector {...{ bone, part, rig, edit }} clear={() => select(null)}/>
        {part?.closed && <WeightTools key={part.id} part={part} rig={rig} brush={activeBrush} setBrush={setBrush} edit={edit} report={setError}/>}
        {last && <p className="studio-history" role="status">{last.actor.kind === "ai" ? "AI" : "Human"} · {last.label}</p>}
      </aside>
      <Timeline {...{ clips, rigId, rig, selected, select }} preview={setAnimation} onDirty={setTimelineDirty}/>
    </div>
  </main>;
}

function WeightTools({part, rig, brush, setBrush, edit, report}: {
  part: VectorPart; rig: KinetixRigState; brush: Brush | null; setBrush: (brush: Brush | null) => void;
  edit: (label: string, ...commands: RigCommand[]) => boolean;
  report: (message: string) => void;
}) {
  const [selectedBone, setSelectedBone] = useState(part.parentId ?? rig.bones[0]?.id ?? "");
  const [radius, setRadius] = useState(34);
  const [strength, setStrength] = useState(0.6);
  const boneId = rig.bones.some(bone => bone.id === selectedBone) ? selectedBone : rig.bones[0]?.id;
  const bound = part.mesh?.bindings.some(binding => binding.id === boneId);
  return <section className="studio-weight">
    <h3>Mesh weights</h3>
    <label>Influence bone<select value={boneId ?? ""} onChange={event => {
      setSelectedBone(event.target.value);
      if (brush) setBrush({ ...brush, boneId: event.target.value });
    }}>
      {!rig.bones.length && <option value="">Add a bone</option>}
      {rig.bones.map(bone => <option key={bone.id} value={bone.id}>{bone.name}</option>)}
    </select></label>
    {!part.mesh ? <button disabled={!boneId} onClick={() => {
      if (!boneId) return;
      try {
        const mesh = bindMesh(part,evaluateRig(rig),boneId);
        edit("Bind mesh", { type:"part.update", id:part.id, changes:{ mesh } });
      } catch {
        report("This path needs a filled area before it can be bound.");
      }
    }}>Bind mesh</button> : <>
      <button aria-pressed={Boolean(brush)} disabled={!bound} onClick={() =>
        setBrush(brush || !boneId ? null : { partId:part.id, boneId, radius, strength })}>Paint weights</button>
      {brush && <>
        <label>Brush radius<input type="range" min={6} max={100} value={radius} onChange={event => {
          const value = event.target.valueAsNumber;
          setRadius(value); setBrush({ ...brush, radius:value });
        }}/></label>
        <label>Brush strength<input type="range" min={0.05} max={1} step={0.05} value={strength} onChange={event => {
          const value = event.target.valueAsNumber;
          setStrength(value); setBrush({ ...brush, strength:value });
        }}/></label>
      </>}
      {!bound && boneId && <button onClick={() => {
        const bone = evaluateRig(rig).get(boneId)!;
        const mesh = part.mesh!;
        edit("Add mesh influence", { type:"part.update", id:part.id, changes:{
          mesh:{ ...mesh, bindings:[...mesh.bindings, { id:boneId, origin:bone.origin, angle:bone.angle }] },
        } });
      }}>Add influence</button>}
      <button onClick={() => {
        setBrush(null);
        edit("Unbind mesh", { type:"part.update", id:part.id, changes:{ mesh:undefined } });
      }}>Unbind</button>
    </>}
  </section>;
}

function Hierarchy({rig, selected, select}: {rig: KinetixRigState; selected: Selection; select: (value: Selection) => void}) {
  const depths = new Map<string, number>();
  return <div className="studio-tree">
    <ul>{orderedBones(rig.bones).map(bone => {
      const depth = bone.parentId === null ? 0 : 1 + (depths.get(bone.parentId) ?? 0);
      depths.set(bone.id, depth);
      return <li key={bone.id}><button style={{ "--depth": Math.min(6, depth) } as CSSProperties}
        aria-pressed={selected?.kind === "bone" && selected.id === bone.id} onClick={() => select({ kind: "bone", id: bone.id })}>
        <BoneIcon size={14}/><span>{bone.name}</span></button></li>;
    })}</ul>
    {rig.parts.length > 0 && <><h3>Paths</h3><ul>{rig.parts.map(part => <li key={part.id}>
      <button aria-pressed={selected?.kind === "part" && selected.id === part.id} onClick={() => select({ kind: "part", id: part.id })}>
        <span className="studio-swatch" style={{ backgroundColor: part.fill }}/><span>{part.name}</span></button></li>)}</ul></>}
    {selected && <button className="studio-deselect" onClick={() => select(null)}>Clear selection</button>}
  </div>;
}

function Inspector({bone, part, rig, edit, clear}: {
  bone?: Bone; part?: VectorPart; rig: KinetixRigState; edit: (label: string, ...commands: RigCommand[]) => boolean;
  clear: () => void;
}) {
  if (bone) {
    const constraint = rig.constraints.find(ik => [ik.upperId, ik.lowerId].includes(bone.id));
    const lower = rig.bones.find(child => child.parentId === bone.id && child.offset.x === bone.length && child.offset.y === 0
      && !rig.constraints.some(ik => [ik.upperId, ik.lowerId].includes(child.id)));
    const change = (changes: Partial<Bone>) => edit("Edit bone", { type: "bone.update", id: bone.id, changes });
    return <div className="studio-properties" key={bone.id}>
      <label>Name<input key={bone.name} defaultValue={bone.name} maxLength={120} onBlur={event => {
        if (event.currentTarget.value.trim() && !change({ name: event.currentTarget.value })) event.currentTarget.value = bone.name;
        if (!event.currentTarget.value.trim()) event.currentTarget.value = bone.name;
      }}/></label>
      <div className="studio-field-pair">
        <Numeric label="X" value={bone.offset.x} disabled={constraint?.lowerId === bone.id}
          onCommit={x => change({ offset: { ...bone.offset, x } })}/>
        <Numeric label="Y" value={bone.offset.y} disabled={constraint?.lowerId === bone.id}
          onCommit={y => change({ offset: { ...bone.offset, y } })}/>
      </div>
      <div className="studio-field-pair">
        <Numeric label="Rotation (°)" value={bone.rotation * degrees} disabled={Boolean(constraint)}
          onCommit={rotation => edit("Rotate bone", { type: "bone.update", id: bone.id, changes: { rotation: rotation / degrees } })}/>
        <Numeric label="Length" value={bone.length} min={0.01} disabled={constraint?.upperId === bone.id}
          onCommit={length => change({ length })}/>
      </div>
      {constraint ? <>
        <div className="studio-field-pair"><Numeric label="Target X" value={constraint.target.x}
          onCommit={x => edit("Move IK target", { type: "ik.target", id: constraint.id, target: { ...constraint.target, x } })}/>
        <Numeric label="Target Y" value={constraint.target.y}
          onCommit={y => edit("Move IK target", { type: "ik.target", id: constraint.id, target: { ...constraint.target, y } })}/></div>
        <button onClick={() => edit("Remove IK", { type: "ik.remove", id: constraint.id })}>Remove IK</button>
      </> : lower && <button onClick={() => {
        const target = evaluateRig(rig).get(lower.id)!.tip;
        edit("Attach IK", { type: "ik.create", constraint: {
          id: crypto.randomUUID(), upperId: bone.id, lowerId: lower.id, target, bend: lower.rotation < 0 ? -1 : 1,
        } });
      }}>Attach two-bone IK</button>}
      <button className="studio-danger" onClick={() => {
        if (window.confirm("Delete this bone, its descendants, and any attached paths?") &&
            edit("Delete bone", { type: "bone.remove", id: bone.id })) clear();
      }}>Delete bone</button>
    </div>;
  }
  if (part) return <div className="studio-properties" key={part.id}>
    <label>Name<input key={part.name} defaultValue={part.name} maxLength={120} onBlur={event => {
      if (!event.currentTarget.value.trim() || !edit("Rename path", { type: "part.update", id: part.id,
        changes: { name: event.currentTarget.value } })) event.currentTarget.value = part.name;
    }}/></label>
    <label>Color<input type="color" value={part.fill} onChange={event =>
      edit("Set path color", { type: "part.update", id: part.id, changes: { fill: event.target.value } })}/></label>
    <label className="studio-check"><input type="checkbox" checked={part.closed} onChange={event =>
      edit("Set path closure", { type: "part.update", id: part.id, changes: { closed: event.target.checked } })}/>Closed path</label>
    <button className="studio-danger" onClick={() => {
      if (edit("Delete path", { type: "part.remove", id: part.id })) clear();
    }}>Delete path</button>
  </div>;
  return <p className="studio-empty">Select a bone or path to edit it.</p>;
}

function Numeric({label, value, min, disabled, onCommit}: {
  label: string; value: number; min?: number; disabled?: boolean; onCommit: (value: number) => boolean;
}) {
  const display = Math.round(value * 100) / 100;
  return <label>{label}<input key={value} type="number" min={min} step="any" disabled={disabled} defaultValue={display}
    onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
    onBlur={event => {
      const next = event.currentTarget.valueAsNumber;
      if (!Number.isFinite(next) || (!Object.is(next, display) && !onCommit(next))) event.currentTarget.value = String(display);
    }}/></label>;
}
