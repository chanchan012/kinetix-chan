"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { exportFormats, formats, type ExportFormat } from "@/lib/export/frames";
import { spriteMaxFrames } from "@/lib/export/sprite-package-options";
import type { Artboard } from "@/lib/rig/model";
import type { SpriteSource } from "@/lib/rig/sprite-sources";
import type { ClipTiming } from "./timeline";
import { SpriteBundleForm } from "./sprite-bundle-form";
import { ProjectArchiveForm } from "./project-archive-form";

type Job = { id: string; format: ExportFormat; status: "queued" | "running" | "ready" | "failed"; byteCount: number | null };
const statusLabel = { queued:"Queued", running:"Rendering", ready:"Ready", failed:"Failed" } as const;

export function ExportDialog({rigId, revision, clip, clips, frameCount, artboard, spriteSources, unsaved, hasArtboard, renderConfigured, close}: {
  rigId: string; revision: number; clip?: ClipTiming; frameCount: number; artboard: Artboard;
  clips:ClipTiming[];spriteSources?:SpriteSource[];
  unsaved: boolean; hasArtboard: boolean; renderConfigured: boolean; close: () => void;
}) {
  const [format, setFormat] = useState<ExportFormat | "sprite-package" | "sprite-bundle" | "fixed-sprites" | "project-archive">("lottie");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<{ parameters: string; id: string } | null>(null);
  const frames = clip?.frameCount ?? frameCount;
  const rigPath = "/api/rigs/" + rigId;
  const path = rigPath + "/exports";
  const isSprite = format === "sprite-package";
  const isFixed = format === "fixed-sprites";
  const isBundle = format === "sprite-bundle" || isFixed;
  const isProject = format === "project-archive";
  const hasScale = isSprite || format==="png-sequence" || format==="spritesheet";
  const frameLimit = isSprite || isBundle || isProject ? spriteMaxFrames : formats[format].frames;
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  useEffect(() => {
    if (isProject) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(path,{cache:"no-store",signal:controller.signal});
        if (!response.ok) throw new Error("Could not load");
        const result: Job[] = await response.json();
        const started = new Set(result.map(job => job.id));
        if (!controller.signal.aborted) {
          setJobs(current => [...current.filter(job => !started.has(job.id) && job.status === "queued"),...result]);
          setLoadError(false);
        }
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh,5000);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [path,isProject]);

  async function enqueue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || isBundle || isProject) return;
    const fields = new FormData(event.currentTarget);
    const scale = hasScale ? Number(fields.get("scale")) : undefined;
    const startFrame = Number(fields.get("start")) - 1;
    const endFrame = Number(fields.get("end")) - 1;
    if (startFrame < 0 || startFrame > endFrame || endFrame >= frames || endFrame - startFrame + 1 > frameLimit) {
      setMessage("Choose a valid frame range within the limit for this format.");
      return;
    }
    if (isSprite) {
      if (!clip || unsaved) return;
      setSending(true);
      setMessage("");
      try {
        const pivot = {x:Number(fields.get("pivotX")),y:Number(fields.get("pivotY"))};
        const response = await fetch(rigPath + "/sprite-package",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({clipId:clip.id,revision,trackRevision:clip.trackRevision,startFrame,endFrame,pivot,
            loop:fields.has("loop"),filter:fields.get("filter"),scale}),
        });
        if (response.status === 409) {
          setMessage("The design or clip changed. Reopen Export after the studio finishes updating.");
          return;
        }
        if (response.status === 400) {
          const failure=await response.json().catch(()=>null);
          setMessage(failure?.error==="missing_image_assets" ? "Relink missing artwork images before exporting." :
            "This sprite package exceeds the render limits. Try a shorter range or smaller artboard.");
          return;
        }
        if (!response.ok) throw new Error("Could not render sprites");
        const url = URL.createObjectURL(await response.blob());
        try {
          const link = document.createElement("a");
          link.href = url;
          link.download = "kinetix-" + clip.id + ".zip";
          link.click();
        } finally {
          setTimeout(() => URL.revokeObjectURL(url),1000);
        }
        setMessage("Sprite package downloaded.");
      } catch {
        setMessage("Could not download the sprite package. Try again.");
      } finally {
        setSending(false);
      }
      return;
    }
    const parameters = {format,clipId:clip?.id,startFrame,endFrame,scale};
    const key = JSON.stringify(parameters);
    const id = pending.current?.parameters === key ? pending.current.id : crypto.randomUUID();
    pending.current = { parameters:key, id };
    setSending(true);
    setMessage("");
    try {
      const response = await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,...parameters})});
      if (!response.ok) {
        const failure = await response.json().catch(()=>null);
        if (failure?.error==="missing_image_assets") setMessage("Relink missing artwork images before exporting.");
        else if (failure?.error==="image_layers_require_a_raster_export") setMessage("This project uses visible image artwork. Choose PNG, sprites, or video.");
        else if (failure?.error==="raster_cels_require_a_raster_export") setMessage("This range contains drawn cels. Choose PNG, sprites, or video.");
        else if (response.status === 400) setMessage("Choose a shorter range or smaller scale for this animation.");
        else setMessage("Could not queue the export. Try again.");
        return;
      }
      const job: Job = await response.json();
      setJobs(current => [job,...current.filter(item => item.id !== job.id)]);
      pending.current = null;
    } catch {
      setMessage("Could not queue the export. Try again.");
    } finally {
      setSending(false);
    }
  }

  return <dialog ref={dialog} className="studio-easing studio-export" aria-label="Export animation" onCancel={close}>
    <header><h2>Export animation</h2><button onClick={close}>Close</button></header>
    {unsaved && !isProject && <p className="studio-export-note">The export uses your saved rig and keyframes.</p>}
    {hasArtboard && <a href={"/api/rigs/" + rigId + "/artboard.png"}>Download saved artboard PNG</a>}
    {!renderConfigured && !isSprite && !isBundle && !isProject && <p className="studio-export-note">Exports will run when the render service is connected.</p>}
      <label className="studio-export-format">Format<select value={format} onChange={event => setFormat(event.target.value as typeof format)}>
        {clip && <option value="sprite-package">Sprite package (ZIP)</option>}
        {clips.length>0 && <option value="sprite-bundle">Portable sprite bundle (ZIP)</option>}
        {clips.length>0 && <option value="fixed-sprites">Fixed-rate sprites (ZIP)</option>}
        <option value="project-archive">Editable project archive (ZIP)</option>
        {exportFormats.map(item => <option key={item} value={item}>{formats[item].label}</option>)}
      </select></label>
    {isProject ? <ProjectArchiveForm {...{rigId,revision,clips,unsaved}}/> : isBundle ?
      <SpriteBundleForm key={format} path={rigPath+"/"+format} fixedRate={isFixed} rigId={rigId} revision={revision} clips={clips} spriteSources={spriteSources}
      activeId={clip?.id} artboard={artboard} unsaved={unsaved}/> : <form onSubmit={enqueue}>
      {hasScale && <label>Pixel scale<select name="scale" defaultValue="1">
        {[1,2,3,4].map(value=><option key={value} value={value}>{value}×</option>)}
      </select></label>}
      <div className="studio-field-pair">
        <label>First frame<input type="number" name="start" min={1} max={frames} defaultValue={1} required/></label>
        <label>Last frame<input key={format} type="number" name="end" min={1} max={frames}
          defaultValue={Math.min(frames,frameLimit)} required/></label>
      </div>
      {isSprite && <>
        <div className="studio-field-pair">
          <label>Pivot X (px)<input type="number" name="pivotX" min={-4096} max={8192} step="any" defaultValue={artboard.width / 2} required/></label>
          <label>Pivot Y (px)<input type="number" name="pivotY" min={-4096} max={8192} step="any" defaultValue={artboard.height} required/></label>
        </div>
        <label>Texture filtering<select name="filter"><option value="nearest">Nearest</option><option value="linear">Linear</option></select></label>
        <label className="studio-check"><input type="checkbox" name="loop" defaultChecked/>Loop animation</label>
      </>}
      <button className="studio-save" disabled={sending || (isSprite && (!clip || unsaved))}>{isSprite ?
        (sending ? "Rendering…" : "Download sprite package") : (sending ? "Queuing…" : "Queue export")}</button>
    </form>}
    {message && <p className="studio-key-error" role="alert">{message}</p>}
    {loadError && !isProject && <p className="studio-key-error" role="status">Could not load export status. Retrying…</p>}
    {jobs.length > 0 && !isProject && <section aria-label="Export jobs" className="studio-export-jobs">
      <h3>Recent exports</h3>
      <ul>{jobs.map(job => <li key={job.id}>
        <span>{formats[job.format].label}</span><span>{statusLabel[job.status]}</span>
        {job.status === "ready" && <a href={path + "/" + job.id + "/download"}>Download</a>}
      </li>)}</ul>
    </section>}
  </dialog>;
}
