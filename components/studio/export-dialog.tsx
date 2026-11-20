"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { exportFormats, formats, type ExportFormat } from "@/lib/export/frames";
import type { ClipTiming } from "./timeline";

type Job = { id: string; format: ExportFormat; status: "queued" | "running" | "ready" | "failed"; byteCount: number | null };
const statusLabel = { queued:"Queued", running:"Rendering", ready:"Ready", failed:"Failed" } as const;

export function ExportDialog({rigId, clip, frameCount, unsaved, hasArtboard, renderConfigured, close}: {
  rigId: string; clip?: ClipTiming; frameCount: number; unsaved: boolean; hasArtboard: boolean; renderConfigured: boolean; close: () => void;
}) {
  const [format, setFormat] = useState<ExportFormat>("lottie");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<{ parameters: string; id: string } | null>(null);
  const frames = clip?.frameCount ?? frameCount;
  const path = "/api/rigs/" + rigId + "/exports";
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  useEffect(() => {
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
  }, [path]);

  async function enqueue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const fields = new FormData(event.currentTarget);
    const startFrame = Number(fields.get("start")) - 1;
    const endFrame = Number(fields.get("end")) - 1;
    if (startFrame < 0 || startFrame > endFrame || endFrame >= frames || endFrame - startFrame + 1 > formats[format].frames) {
      setMessage("Choose a valid frame range within the limit for this format.");
      return;
    }
    const parameters = {format,clipId:clip?.id,startFrame,endFrame};
    const key = JSON.stringify(parameters);
    const id = pending.current?.parameters === key ? pending.current.id : crypto.randomUUID();
    pending.current = { parameters:key, id };
    setSending(true);
    setMessage("");
    try {
      const response = await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,...parameters})});
      if (!response.ok) {
        if (response.status === 400) setMessage("Choose a shorter range for this animation.");
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
    {unsaved && <p className="studio-export-note">The export uses your saved rig and keyframes.</p>}
    {hasArtboard && <a href={"/api/rigs/" + rigId + "/artboard.png"}>Download saved artboard PNG</a>}
    {!renderConfigured && <p className="studio-export-note">Exports will run when the render service is connected.</p>}
    <form onSubmit={enqueue}>
      <label>Format<select value={format} onChange={event => setFormat(event.target.value as ExportFormat)}>
        {exportFormats.map(item => <option key={item} value={item}>{formats[item].label}</option>)}
      </select></label>
      <div className="studio-field-pair">
        <label>First frame<input type="number" name="start" min={1} max={frames} defaultValue={1} required/></label>
        <label>Last frame<input key={format} type="number" name="end" min={1} max={frames}
          defaultValue={Math.min(frames,formats[format].frames)} required/></label>
      </div>
      <button className="studio-save" disabled={sending}>{sending ? "Queuing…" : "Queue export"}</button>
    </form>
    {message && <p className="studio-key-error" role="alert">{message}</p>}
    {loadError && <p className="studio-key-error" role="status">Could not load export status. Retrying…</p>}
    {jobs.length > 0 && <section aria-label="Export jobs" className="studio-export-jobs">
      <h3>Recent exports</h3>
      <ul>{jobs.map(job => <li key={job.id}>
        <span>{formats[job.format].label}</span><span>{statusLabel[job.status]}</span>
        {job.status === "ready" && <a href={path + "/" + job.id + "/download"}>Download</a>}
      </li>)}</ul>
    </section>}
  </dialog>;
}
