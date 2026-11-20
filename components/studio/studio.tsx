"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useStore } from "zustand";
import { ArrowLeft, ArrowCounterClockwise, ArrowClockwise, Bone as BoneIcon, Cursor, FloppyDisk, Keyboard, PencilSimple, PenNib, Polygon, Selection as SelectionIcon, Shapes } from "@phosphor-icons/react";
import { createRigStore } from "@/lib/rig/store";
import { evaluateRig, rotatePoint } from "@/lib/rig/kinematics";
import { artboardFor, orderedBones, referenceFrameCount, type Bone, type KinetixRigState, type Point, type VectorKnot, type VectorPart } from "@/lib/rig/model";
import { sampleRig } from "@/lib/rig/animation";
import { bindMesh } from "@/lib/rig/skinning";
import type { RigCommand } from "@/lib/rig/commands";
import { primitiveShapes, type PrimitiveShape } from "@/lib/rig/path-geometry";
import { Viewport, type Selection, type SelectionMode, type Tool, type Brush } from "./viewport";
import { Timeline, type ClipTiming, type FramePreview } from "./timeline";
import { ExportDialog } from "./export-dialog";
import { ShareDialog } from "./share-dialog";
import { McpDialog } from "./mcp-dialog";
import { useRoom } from "./use-room";
import { PanelHandle, usePanelLayout } from "./panel-layout";
import { ShortcutsDialog, useStudioShortcuts } from "./shortcuts";
import { Presence } from "./presence";
import { ClipManager } from "./clip-manager";
import { ArtboardFields, readArtboardFields } from "../artboard-fields";
import { Dialog } from "../dialog";

type Props = {
  actorId: string; rigId: string; name: string; initial: KinetixRigState; revision: number; clips: ClipTiming[];
  renderConfigured: boolean;
  owned: boolean;
};
const degrees = 180 / Math.PI;
const tools = [{ id: "select", label: "Select", icon: Cursor, key: "V" },
  { id: "bone", label: "Draw bone", icon: BoneIcon, key: "B" },
  { id: "pen", label: "Pen", icon: PenNib, key: "P" },
  { id: "polygon", label: "Polygon", icon: Polygon, key: "G" },
  { id: "primitive", label: "Shapes", icon: Shapes, key: "M" },
  { id: "pencil", label: "Pencil", icon: PencilSimple, key: "N" },
  { id: "region", label: "Region select", icon: SelectionIcon, key: "Q" }] as const;
const zoomLevels = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export function Studio({actorId, rigId, name, initial, revision: initialRevision, clips, renderConfigured, owned}: Props) {
  const [store] = useState(() => createRigStore(initial));
  const rig = useStore(store, state => state.rig);
  const past = useStore(store, state => state.past);
  const future = useStore(store, state => state.future);
  const [saved, setSaved] = useState(rig);
  const [revision, setRevision] = useState(initialRevision);
  const [selected,setSelected] = useState<Selection>(rig.bones[0] ? { kind: "bone", id: rig.bones[0].id } : null);
  const [selectionIds,setSelectionIds] = useState<string[]>([]);
  const [edgeSelection, setEdgeSelection] = useState<{partId:string; index:number} | null>(null);
  const [nodeSelection,setNodeSelection] = useState<{partId:string;index:number} | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [primitive, setPrimitive] = useState<PrimitiveShape>("rectangle");
  const [smoothing,setSmoothing] = useState(2);
  const [selectionMode,setSelectionMode] = useState<SelectionMode>("marquee");
  const [snapping,setSnapping] = useState(false);
  const [rulers,setRulers] = useState(false);
  const [guidesOpen,setGuidesOpen] = useState(false);
  const [pen, setPen] = useState<VectorKnot[]>([]);
  const [showBones, setShowBones] = useState(true);
  const [reference, setReference] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [animation, setAnimation] = useState<FramePreview>({ frame: 0, frames: referenceFrameCount(initial), tracks: [], onion: false });
  const [timelineDirty, setTimelineDirty] = useState(false);
  const [clip, setClip] = useState<ClipTiming | undefined>(clips[0]);
  const [clipId, selectClip] = useState(clips[0]?.id ?? "");
  const [liveClips, setLiveClips] = useState(clips);
  const [exportOpen, setExportOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [clipsOpen, setClipsOpen] = useState(false);
  const [artboardOpen, setArtboardOpen] = useState(false);
  const [brush, setBrush] = useState<Brush | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const room = useRoom(rigId,selected,clips);
  const layout = usePanelLayout(Boolean(clip));
  const remoteBones = new Set(room.presence.flatMap(entry => entry.selection?.kind === "bone" ? [entry.selection.id] : []));
  const pending = useRef(false);
  const clipRefresh = useRef(0);
  const dirty = saved !== rig;
  const bone = selected?.kind === "bone" ? rig.bones.find(item => item.id === selected.id) : undefined;
  const part = selected?.kind === "part" ? rig.parts.find(item => item.id === selected.id) : undefined;
  const selectedParts = rig.parts.filter(item=>selectionIds.includes(item.id)).map(item=>item.id);
  function select(value:Selection) {
    setSelected(value);
    setSelectionIds(value?.kind==="part" ? [value.id] : []);
  }
  function selectRegion(ids:string[]) {
    setSelectionIds(ids);
    setSelected(ids.length ? {kind:"part",id:ids.at(-1)!} : null);
    setTool("select");
  }
  const selectedEdge = edgeSelection && edgeSelection.partId === part?.id ? edgeSelection.index : -1;
  const setEdge = (index:number) => setEdgeSelection(part && index >= 0 ? {partId:part.id,index} : null);
  const selectedNode = part && nodeSelection?.partId === part.id ? Math.min(nodeSelection.index,part.knots.length-1) : -1;
  const setNode = (index:number) => setNodeSelection(part ? {partId:part.id,index} : null);
  const activeBrush = part && selectedParts.length === 1 && brush?.partId === part.id && part.mesh && tool === "select" &&
    part.mesh.bindings.some(binding => binding.id === brush.boneId) ? brush : null;
  const pose = useMemo(() => sampleRig(rig,animation.tracks,animation.frame), [rig,animation]);
  const phase = animation.frame / animation.frames;
  const ghosts = useMemo(() => !animation.onion ? [] : [-1,1].map(offset => {
    const frame = Math.min(animation.frames - 1, Math.max(0, animation.frame + offset));
    return { rig: sampleRig(rig,animation.tracks,frame), phase: frame / animation.frames, frame };
  }).filter(ghost => ghost.frame !== animation.frame), [rig,animation]);
  const last = past.at(-1);
  const path = "/api/rigs/" + rigId + "/state";

  const refreshClips = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++clipRefresh.current;
    const response = await fetch("/api/rigs/" + rigId + "/animation", {cache:"no-store", signal});
    if (!response.ok) throw Error("Could not refresh animation clips.");
    const rows: ClipTiming[] = await response.json();
    if (!signal?.aborted && sequence === clipRefresh.current) {
      setLiveClips(rows);
      selectClip(current => current && !rows.some(row => row.id === current) ? "" : current);
    }
    return rows;
  }, [rigId]);

  useEffect(() => {
    if (!room.timeline) return;
    const controller = new AbortController();
    const timer = setTimeout(() => void refreshClips(controller.signal).catch(() => {}), 180);
    return () => { clearTimeout(timer); controller.abort(); };
  },[room.timeline,refreshClips]);

  function clipChanged(id: string, action: "create" | "update" | "delete") {
    if (action === "delete") {
      setLiveClips(rows => rows.filter(row => row.id !== id));
      selectClip(current => current === id ? "" : current);
    }
    void refreshClips().then(rows => {
      if (action === "create" && rows.some(row => row.id === id)) selectClip(id);
    }).catch(() => setError("Clip changes were saved. Could not refresh the timeline."));
  }

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

  async function save(reload = false, incoming = false) {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(path, reload ? { cache: "no-store" } : {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(room.clientId && {"X-Kinetix-Client":room.clientId}) },
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
      if (reload && rig !== store.getState().rig) {
        setConflict(true);
        return;
      }
      if (reload) store.getState().reset(next.state);
      setSaved(reload ? store.getState().rig : rig);
      setRevision(next.revision);
      setConflict(false);
    } catch {
      setError(incoming ? "Could not load the latest collaboration update." :
        reload ? "Could not reload the saved rig." : "Could not save. Your edits are still in the studio.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  const autosave = useEffectEvent(() => { void save(); });
  const reconcile = useEffectEvent(() => {
    if (dirty) setConflict(true);
    else void save(true,true);
  });
  useEffect(() => {
    if (saving || conflict || room.revision <= revision) return;
    const timer = setTimeout(reconcile,error ? 5000 : 120);
    return () => clearTimeout(timer);
  }, [room.revision,revision,saving,conflict,error]);

  useEffect(() => {
    if (!dirty || saving || conflict || room.revision > revision) return;
    const timer = setTimeout(autosave,error ? 7000 : 850);
    return () => clearTimeout(timer);
  }, [dirty,rig,saving,conflict,error,room.revision,revision]);

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

  function finishPath(closed: boolean, drawing = pen) {
    if (drawing.length < (closed ? 3 : 2)) return;
    const id = crypto.randomUUID();
    const parent = bone ? evaluateRig(rig).get(bone.id) : undefined;
    const toLocal = (point: Point) => parent ?
      rotatePoint({ x: point.x - parent.origin.x, y: point.y - parent.origin.y }, -parent.angle) : point;
    const knots = drawing.map(knot => ({
      point: toLocal(knot.point),
      incoming: knot.incoming && toLocal(knot.incoming),
      outgoing: knot.outgoing && toLocal(knot.outgoing),
      mode: knot.mode,
    }));
    const kind = tool === "primitive" ? primitive[0].toUpperCase() + primitive.slice(1) : tool === "polygon" ? "Polygon" : "Path";
    if (edit("Draw " + kind.toLowerCase(), { type: "part.create", part: {
      id, parentId: bone?.id ?? null, name: kind + " " + (rig.parts.length + 1), offset: { x: 0, y: 0 },
      knots, fill: "#b54b2b", closed,
    } })) {
      select({ kind: "part", id });
      setPen([]);
      setTool("select");
    }
  }

  function chooseTool(next: Tool) {
    if (next !== tool) setPen([]);
    if (next === "bone") setShowBones(true);
    if (next === "select") setBrush(null);
    setTool(next);
  }

  useStudioShortcuts(event => {
    if (event.altKey) return;
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (modifier && key === "s") {
      event.preventDefault();
      if (!event.repeat && dirty && !conflict) void save();
    } else if (modifier && (key === "z" || key === "y")) {
      event.preventDefault();
      if (key === "y" || event.shiftKey) store.getState().redo();
      else store.getState().undo();
    } else if (!modifier) {
      const next = tools.find(item => item.key.toLowerCase() === key);
      if (next && !event.repeat) {
        event.preventDefault();
        chooseTool(next.id);
      } else if (key === "escape") chooseTool("select");
      else if (key === "enter" && (tool === "pen" || tool === "polygon") && !event.repeat &&
        !(event.target instanceof HTMLElement && event.target.closest("button, a, summary"))) {
        event.preventDefault();
        finishPath(tool === "polygon" || event.shiftKey);
      } else if (key === "h" && !event.repeat) {
        event.preventDefault();
        setShowBones(value => !value);
      } else if (key === "?" && !event.repeat) {
        event.preventDefault();
        setShortcutsOpen(true);
      } else if (["+","=","-","0"].includes(key)) {
        event.preventDefault();
        setZoom(value => key === "0" ? 1 :
          zoomLevels[Math.max(0, Math.min(zoomLevels.length-1, zoomLevels.indexOf(value) + (key === "-" ? -1 : 1)))]);
      }
    }
  });

  return <main className="app-shell studio-shell">
    <header className="studio-header">
      <Link href="/dashboard" className="studio-back" aria-label="Rig library" onClick={event => {
        if ((dirty || timelineDirty) && !window.confirm("Leave the studio with unsaved edits?")) event.preventDefault();
      }}><ArrowLeft size={17}/><span>Library</span></Link>
      <h1 title={name}>{name}</h1>
      <span role="status" className="studio-save-status">{conflict ? "Save conflict" : saving ? "Saving…" : dirty ? "Unsaved" : timelineDirty ? "Unsaved keys" : "Saved"}</span>
      <button className="studio-save studio-header-save" aria-label="Save" title="Save rig (Ctrl or ⌘ + S)"
        disabled={!dirty || saving || conflict} onClick={() => void save()}><FloppyDisk size={17}/></button>
      <Presence connected={room.connected} entries={room.presence} rig={rig}/>
      <button className="studio-header-icon" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)"
        onClick={() => setShortcutsOpen(true)}><Keyboard size={19}/></button>
      {owned && <nav className="studio-owner-actions" aria-label="Rig actions">
        <button className="studio-export-button" onClick={() => setExportOpen(true)}>Export</button>
        <button className="studio-export-button" onClick={() => setShareOpen(true)}>Share</button>
        <button className="studio-export-button" onClick={() => setMcpOpen(true)}>MCP</button>
      </nav>}
    </header>

    {(error || conflict) && <aside className="studio-alert" role="alert">
      {conflict ? <>This rig changed elsewhere. <button disabled={saving} onClick={() => {
        if (window.confirm("Reload the saved rig and discard local changes?")) void save(true);
      }}>Reload saved rig</button></> : error}
    </aside>}

    <div className="studio-grid" ref={layout.ref} style={layout.style}>
      <aside className="studio-hierarchy" id="studio-hierarchy" aria-label="Rig hierarchy">
        <div className="studio-panel-title"><h2>Hierarchy</h2><span>{rig.bones.length} bones</span></div>
        <Hierarchy rig={rig} selected={selected} selectedParts={selectedParts} select={select}/>
      </aside>
      <PanelHandle panel="hierarchy" size={layout.panels.hierarchy} label="Resize hierarchy" controls="studio-hierarchy"/>
      <PanelHandle panel="split" size={layout.panels.split} label="Resize side panels" controls="studio-hierarchy studio-inspector"/>
      <section className="studio-stage" aria-label="Viewport">
        <div className="studio-tool-group studio-tools" role="group" aria-label="Canvas tools">
          {tools.map(({id, label, icon: Icon, key}) => <button key={id} aria-label={label} title={label + " (" + key + ")"}
            aria-keyshortcuts={key} aria-pressed={tool === id} onClick={() => chooseTool(id)}><Icon size={19}/></button>)}
        </div>
        <div className="studio-tool-group studio-viewport-actions" role="group" aria-label="Command history and zoom">
          <button title="Undo (Ctrl or ⌘ + Z)" aria-label="Undo" disabled={!past.length} onClick={store.getState().undo}><ArrowCounterClockwise size={17}/></button>
          <button title="Redo (Ctrl or ⌘ + Shift + Z)" aria-label="Redo" disabled={!future.length} onClick={store.getState().redo}><ArrowClockwise size={17}/></button>
          <label className="studio-zoom"><span className="sr-only">Zoom</span><select value={zoom} onChange={event => setZoom(Number(event.target.value))}>
            {zoomLevels.map(level => <option key={level} value={level}>{level === 1 ? "Fit" : level * 100 + "%"}</option>)}
          </select></label>
        </div>
        <div className="studio-artboard"><Viewport rig={pose} brush={activeBrush} ghosts={ghosts} remoteBones={remoteBones}
          {...{ phase, selected, selectedParts, selectedEdge, selectedNode, setNode, select, selectRegion, tool, primitive, smoothing,
            selectionMode, snapping, rulers, reference, zoom, showBones, pen, addBone, edit }}
          closePolygon={() => finishPath(true)}
          addDrawnPath={(closed,knots) => finishPath(closed,knots)}
          addKnot={knot => setPen(knots => knots.length < 256 ? [...knots, knot] : knots)}/></div>
        <div className="studio-stage-footer">
          {tool === "region" ? <div className="studio-tool-group studio-zoom">
            <label><span className="sr-only">Region selection mode</span><select value={selectionMode}
              onChange={event=>setSelectionMode(event.target.value as SelectionMode)}>
              <option value="marquee">Marquee</option><option value="lasso">Lasso</option>
            </select></label>
          </div> : tool === "primitive" ? <div className="studio-tool-group">
            <label className="studio-zoom"><span className="sr-only">Shape</span><select value={primitive}
              onChange={event => setPrimitive(event.target.value as PrimitiveShape)}>
              {primitiveShapes.map(shape => <option key={shape} value={shape}>{shape[0].toUpperCase() + shape.slice(1)}</option>)}
            </select></label>
          </div> : tool === "pencil" ? <div className="studio-tool-group studio-zoom">
            <label>Smoothing<select value={smoothing} onChange={event => setSmoothing(Number(event.target.value))}>
              <option value={0.75}>Low</option><option value={2}>Medium</option><option value={4}>High</option>
            </select></label>
          </div> : tool === "pen" || tool === "polygon" ? <div className="studio-tool-group">
            {tool === "pen" && <button disabled={pen.length < 2} onClick={() => finishPath(false)}>Finish path</button>}
            <button disabled={pen.length < 3} onClick={() => finishPath(true)}>{tool === "polygon" ? "Close polygon" : "Close shape"}</button>
          </div> : <div className="studio-tool-group">
            <button title="Show or hide bones (H)" aria-pressed={showBones} onClick={() => setShowBones(value => !value)}>Bones</button>
            {rig.study && <button aria-pressed={reference} onClick={() => setReference(value => !value)}>Artwork</button>}
            {rig.version === 2 && <button onClick={() => setArtboardOpen(true)}>Artboard</button>}
            {rig.version === 2 && <button onClick={() => setGuidesOpen(true)}>Guides</button>}
            <button aria-pressed={rulers} onClick={() => setRulers(value=>!value)}>Rulers</button>
            <button aria-pressed={snapping} title="Snap to guides, artboard edges and 10 px grid. Hold Alt to override."
              onClick={() => setSnapping(value=>!value)}>Snap</button>
          </div>}
        </div>
      </section>
      <PanelHandle panel="inspector" size={layout.panels.inspector} label="Resize inspector" controls="studio-inspector" direction={-1}/>
      <aside className="studio-inspector" id="studio-inspector" aria-label="Inspector">
        <div className="studio-panel-title"><h2>Inspector</h2></div>
        {selectedParts.length > 1 ? <SelectionLayout ids={selectedParts} edit={edit} clear={() => select(null)}/> :
          <Inspector {...{ bone, part, rig, edit, selectedEdge, setEdge, selectedNode, setNode }} clear={() => select(null)}/>}
        {part?.closed && selectedParts.length===1 && <WeightTools key={part.id} part={part} rig={rig} brush={activeBrush} setBrush={setBrush} edit={edit} report={setError}/>}
        {last && <p className="studio-history" role="status">{last.actor.kind === "ai" ? "AI" : "Human"} · {last.label}</p>}
        {!last && room.lastEdit?.kind === "ai" && <p className="studio-history" role="status">AI · {room.lastEdit.label ?? "Edit rig"}</p>}
      </aside>
      <PanelHandle panel="timeline" orientation="horizontal" size={layout.panels.timeline} label="Resize timeline"
        controls="studio-timeline" direction={-1}/>
      <Timeline {...{ rigId, rig, selected, select, clipId, selectClip }} clips={liveClips}
        manageClips={() => setClipsOpen(true)} preview={setAnimation} onDirty={setTimelineDirty} onClip={setClip}/>
    </div>
    {exportOpen && <ExportDialog rigId={rigId} revision={revision} clip={clip} frameCount={referenceFrameCount(rig)} artboard={artboardFor(rig)}
      unsaved={dirty || timelineDirty} hasArtboard={rig.version === 2} renderConfigured={renderConfigured} close={() => setExportOpen(false)}/>}
    {shareOpen && <ShareDialog rigId={rigId} close={() => setShareOpen(false)}/>}
    {mcpOpen && <McpDialog rigId={rigId} close={() => setMcpOpen(false)}/>}
    {shortcutsOpen && <ShortcutsDialog close={() => setShortcutsOpen(false)}/>}
    {clipsOpen && <ClipManager rigId={rigId} close={() => setClipsOpen(false)} changed={clipChanged}/>}
    {artboardOpen && rig.version === 2 && <Dialog title="Artboard settings" className="studio-easing studio-export" onClose={() => setArtboardOpen(false)}>
      <form onSubmit={event => {
        event.preventDefault();
        const artboard = readArtboardFields(new FormData(event.currentTarget));
        if (edit("Edit artboard", { type: "artboard.update", artboard })) setArtboardOpen(false);
      }}>
        <ArtboardFields artboard={rig.artboard}/>
        <button className="studio-save">Apply artboard settings</button>
      </form>
    </Dialog>}
    {guidesOpen && rig.version === 2 && <GuideDialog guides={rig.guides ?? []} edit={edit} close={() => setGuidesOpen(false)}/>}
  </main>;
}

type Edit = (label:string,...commands:RigCommand[])=>boolean;
type Guides = Extract<KinetixRigState,{version:2}>["guides"];

function GuideDialog({guides,edit,close}: {guides:NonNullable<Guides>;edit:Edit;close:()=>void}) {
  return <Dialog title="Artboard guides" className="studio-easing studio-export" onClose={close}>
    <form onSubmit={event => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const axis = fields.get("axis")==="x" ? "x" : "y";
      const position = Number(fields.get("position"));
      if (!guides.some(guide=>guide.axis===axis && guide.position===position)) {
        edit("Add guide",{type:"artboard.guides",guides:[...guides,{axis,position}]});
      }
    }}>
      <label>Orientation<select name="axis"><option value="x">Vertical</option><option value="y">Horizontal</option></select></label>
      <label>Position (px)<input type="number" name="position" step="any" min={-1000000} max={1000000} defaultValue={100} required/></label>
      <button className="studio-save" disabled={guides.length>=64}>Add guide</button>
    </form>
    {guides.length>0 && <div className="studio-properties" aria-label="Saved guides">{guides.map((guide,index)=>
      <button key={guide.axis + ":" + guide.position + ":" + index} onClick={() =>
        edit("Remove guide",{type:"artboard.guides",guides:guides.filter((_,i)=>i!==index)})}>
        Remove {guide.axis==="x" ? "vertical" : "horizontal"} guide at {guide.position}px
      </button>
    )}</div>}
  </Dialog>;
}

const alignments = [
  ["x","min","Align left"],["x","center","Align horizontal centers"],["x","max","Align right"],
  ["y","min","Align top"],["y","center","Align vertical centers"],["y","max","Align bottom"],
  ["x","distribute","Distribute horizontally"],["y","distribute","Distribute vertically"],
] as const;

function SelectionLayout({ids,edit,clear}: {ids:string[];edit:Edit;clear:()=>void}) {
  return <div className="studio-properties">
    <p>{ids.length} paths selected</p>
    {alignments.map(([axis,mode,label])=><button key={label} disabled={mode==="distribute" && ids.length<3}
      onClick={() => edit(label,{type:"parts.layout",ids,axis,mode})}>{label}</button>)}
    <button onClick={clear}>Clear selection</button>
  </div>;
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

function Hierarchy({rig, selected, selectedParts, select}: {
  rig: KinetixRigState; selected: Selection; selectedParts:string[]; select: (value: Selection) => void;
}) {
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
      <button aria-pressed={selectedParts.includes(part.id)} onClick={() => select({ kind: "part", id: part.id })}>
        <span className="studio-swatch" style={{ backgroundColor: part.fill }}/><span>{part.name}</span></button></li>)}</ul></>}
    {selected && <button className="studio-deselect" onClick={() => select(null)}>Clear selection</button>}
  </div>;
}

function Inspector({bone, part, rig, edit, clear, selectedEdge, setEdge, selectedNode, setNode}: {
  bone?: Bone; part?: VectorPart; rig: KinetixRigState; edit: (label: string, ...commands: RigCommand[]) => boolean;
  clear: () => void; selectedEdge:number; setEdge:(index:number)=>void;
  selectedNode:number; setNode:(index:number)=>void;
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
  if (part) return <PathProperties key={part.id} {...{ part, rig, edit, clear, selectedEdge, setEdge, selectedNode, setNode }}/>;
  return <p className="studio-empty">Select a bone or path to edit it.</p>;
}

function PathProperties({part, rig, edit, clear, selectedEdge:edge, setEdge, selectedNode, setNode}: {
  part: VectorPart; rig: KinetixRigState; edit: (label: string, ...commands: RigCommand[]) => boolean; clear: () => void;
  selectedEdge:number; setEdge:(index:number)=>void;
  selectedNode:number; setNode:(index:number)=>void;
}) {
  const order = rig.parts.indexOf(part);
  const edges = part.closed ? part.knots.length : part.knots.length-1;
  const canSplit = edge >= 0 && edge < edges && part.knots.length < 256;
  const [joinSource,setJoinSource] = useState("");
  const [simplifyTolerance,setSimplifyTolerance] = useState("1");
  const joinOptions = part.closed ? [] : rig.parts.filter(item=>item.id!==part.id && !item.closed && item.parentId===part.parentId);
  const scale = part.scale ?? {x:1,y:1};
  const pivot = part.pivot ?? {x:0,y:0};
  const transform = (label:string,changes:Partial<VectorPart>) => edit(label,{type:"part.update",id:part.id,changes});
  return <div className="studio-properties">
    <label>Name<input key={part.name} defaultValue={part.name} maxLength={120} onBlur={event => {
      if (!event.currentTarget.value.trim() || !edit("Rename path", { type: "part.update", id: part.id,
        changes: { name: event.currentTarget.value } })) event.currentTarget.value = part.name;
    }}/></label>
    <label>Color<input type="color" value={part.fill} onChange={event =>
      edit("Set path color", { type: "part.update", id: part.id, changes: { fill: event.target.value } })}/></label>
    <div className="studio-field-pair">
      <Numeric label="Position X (px)" value={part.offset.x} onCommit={x => transform("Move path",{offset:{...part.offset,x}})}/>
      <Numeric label="Position Y (px)" value={part.offset.y} onCommit={y => transform("Move path",{offset:{...part.offset,y}})}/>
    </div>
    <Numeric label="Rotation (°)" value={(part.rotation ?? 0) * degrees} onCommit={value => transform("Rotate path",{rotation:value / degrees})}/>
    <div className="studio-field-pair">
      <Numeric label="Scale X (%)" value={scale.x * 100} onCommit={value => transform("Scale path",{scale:{...scale,x:value/100}})}/>
      <Numeric label="Scale Y (%)" value={scale.y * 100} onCommit={value => transform("Scale path",{scale:{...scale,y:value/100}})}/>
    </div>
    <div className="studio-field-pair">
      <Numeric label="Pivot X (px)" value={pivot.x} onCommit={x => edit("Move path pivot",{type:"part.pivot",id:part.id,pivot:{...pivot,x}})}/>
      <Numeric label="Pivot Y (px)" value={pivot.y} onCommit={y => edit("Move path pivot",{type:"part.pivot",id:part.id,pivot:{...pivot,y}})}/>
    </div>
    <div className="studio-field-pair">
      <button onClick={() => transform("Flip path horizontally",{scale:{...scale,x:-scale.x}})}>Flip horizontal</button>
      <button onClick={() => transform("Flip path vertically",{scale:{...scale,y:-scale.y}})}>Flip vertical</button>
    </div>
    <label className="studio-check"><input type="checkbox" checked={part.closed} onChange={event =>
      edit("Set path closure", { type: "part.update", id: part.id, changes: { closed: event.target.checked } })}/>Closed path</label>
    <div className="studio-field-pair">
      <button disabled={order >= rig.parts.length - 1} onClick={() =>
        edit("Bring forward", { type: "part.reorder", id: part.id, direction: "forward" })}>Bring forward</button>
      <button disabled={order <= 0} onClick={() =>
        edit("Send backward", { type: "part.reorder", id: part.id, direction: "backward" })}>Send backward</button>
    </div>
    <div className="studio-field-pair">
      <label>Edge<select value={edge < edges ? edge : -1} onChange={event => setEdge(Number(event.target.value))}>
        <option value={-1}>Choose edge</option>
        {Array.from({length:edges},(_,index) => <option key={index} value={index}>
          {index + 1} to {(index + 1) % part.knots.length + 1}
        </option>)}
      </select></label>
      <button disabled={!canSplit} onClick={() => {
        if (edit("Split edge", { type: "part.splitEdge", id: part.id, edge })) {
          setEdge(-1);
          setNode(-1);
        }
      }}>Split edge</button>
    </div>
    <label>Node<select value={selectedNode} onChange={event => setNode(Number(event.target.value))}>
      <option value={-1}>Choose node</option>
      {part.knots.map((_,index) => <option key={index} value={index}>Node {index+1}</option>)}
    </select></label>
    <div className="studio-field-pair">
      {(["corner","smooth"] as const).map(mode => <button key={mode} disabled={selectedNode<0} onClick={() => {
        if (part.mesh && !window.confirm("Change the node and remove this path’s mesh binding?")) return;
        edit("Set " + mode + " node",{type:"part.nodeMode",id:part.id,index:selectedNode,mode});
      }}>{mode === "corner" ? "Corner node" : "Smooth node"}</button>)}
    </div>
    <button onClick={() => {
      if (edit("Reverse path",{type:"part.reverse",id:part.id})) {
        setEdge(-1);
        setNode(-1);
      }
    }}>Reverse path</button>
    <button disabled={selectedNode < 0 || (!part.closed && (selectedNode === 0 || selectedNode === part.knots.length-1))}
      onClick={() => {
        if (part.mesh && !window.confirm("Cut the path and remove its mesh binding?")) return;
        if (edit("Cut path",{type:"part.cut",id:part.id,index:selectedNode,newId:crypto.randomUUID()})) {
          setNode(-1);
          setEdge(-1);
        }
      }}>Cut at node</button>
    {joinOptions.length > 0 && <div className="studio-field-pair">
      <label>Join with<select value={joinSource} onChange={event=>setJoinSource(event.target.value)}>
        <option value="">Choose path</option>
        {joinOptions.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <button disabled={!joinOptions.some(item=>item.id===joinSource)} onClick={() => {
        if (edit("Join paths",{type:"part.join",id:part.id,sourceId:joinSource})) setJoinSource("");
      }}>Join paths</button>
    </div>}
    <div className="studio-field-pair">
      <label>Simplify tolerance (px)<input type="number" min={0.01} max={100} step="any" value={simplifyTolerance}
        onChange={event=>setSimplifyTolerance(event.target.value)}/></label>
      <button disabled={!(Number(simplifyTolerance)>=0.01 && Number(simplifyTolerance)<=100)} onClick={() => {
        if (part.mesh && !window.confirm("Simplify the path and remove its mesh binding?")) return;
        if (edit("Simplify path",{type:"part.simplify",id:part.id,tolerance:Number(simplifyTolerance)})) {
          setNode(-1);
          setEdge(-1);
        }
      }}>Simplify path</button>
    </div>
    <button className="studio-danger" onClick={() => {
      if (edit("Delete path", { type: "part.remove", id: part.id })) clear();
    }}>Delete path</button>
  </div>;
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
