"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { FilmSlate, Plus } from "@phosphor-icons/react";
import { Dialog } from "../dialog";

type Clip = { id: string; name: string; fps: number; frameCount: number; thumbnail: string | null };

export function ClipManager({rigId, close, changed}: {
  rigId: string;
  close: () => void;
  changed: (id: string, action: "create" | "update" | "delete") => void;
}) {
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [editor, setEditor] = useState<Clip | "new" | null>(null);
  const [deleting, setDeleting] = useState<Clip | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const locked = useRef(false);
  const path = "/api/rigs/" + rigId + "/clips";

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(path, {cache:"no-store", signal:controller.signal});
        if (!response.ok) throw Error("Could not load animation clips.");
        const rows: Clip[] = await response.json();
        if (controller.signal.aborted) return;
        if (!locked.current) setClips(rows);
        if (locked.current || rows.some(clip => !clip.thumbnail)) timer = setTimeout(refresh, 30_000);
      } catch {
        if (!controller.signal.aborted) setError("Could not load animation clips.");
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [path, attempt]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    const fields = new FormData(event.currentTarget);
    const target = deleting ?? (editor === "new" ? null : editor);
    const action = deleting ? "delete" : target ? "update" : "create";
    const method = action === "delete" ? "DELETE" : action === "update" ? "PATCH" : "POST";
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(path + (target ? "/" + target.id : ""), {
        method, headers: {"Content-Type":"application/json"},
        body: deleting ? undefined : JSON.stringify({
          name:fields.get("name"), fps:Number(fields.get("fps")), frameCount:Number(fields.get("frames")),
        }),
      });
      if (!response.ok) throw Error("Could not save the clip. Try again.");
      const clip: Clip = deleting ?? await response.json();
      setClips(rows => {
        const remaining = (rows ?? []).filter(row => row.id !== clip.id);
        return action === "delete" ? remaining : [...remaining, clip].sort((a, b) => a.name.localeCompare(b.name));
      });
      setEditor(null);
      setDeleting(null);
      setAttempt(value => value + 1);
      changed(clip.id, action);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save the clip.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const editing = editor && editor !== "new" ? editor : null;
  const formOpen = editor || deleting;

  return <Dialog title="Animation clips" className="studio-easing studio-clips" onClose={() => { if (!locked.current) close(); }}>
    {clips === null ? !error && <p role="status">Loading clips…</p> : clips.length === 0 ? <p>No saved clips yet.</p> :
      <ul>{clips.map(clip => <li key={clip.id}>
        <span className="studio-clip-thumb">{clip.thumbnail ? <img src={clip.thumbnail} alt=""/> : <FilmSlate size={18}/>}</span>
        <span className="studio-clip-info"><strong>{clip.name}</strong><small>{clip.frameCount} frames · {clip.fps} fps</small></span>
        <button type="button" aria-label={"Edit " + clip.name} disabled={busy}
          onClick={() => { setEditor(clip); setDeleting(null); setError(""); }}>Edit</button>
        <button type="button" aria-label={"Delete " + clip.name} disabled={busy}
          onClick={() => { setDeleting(clip); setEditor(null); setError(""); }}>Delete</button>
      </li>)}</ul>}
    {error && <p role="alert">{error} {clips === null && <button onClick={() => {setError(""); setAttempt(value => value + 1);}}>Retry</button>}</p>}
    {!formOpen && <button className="studio-save" disabled={clips === null}
      onClick={() => { setEditor("new"); setError(""); }}><Plus size={16}/>New clip</button>}
    {formOpen && <form onSubmit={save} key={deleting?.id ?? editing?.id ?? "new"}>
      {deleting ? <p>Delete <strong>{deleting.name}</strong> and its keyframes?</p> : <>
        <label>Clip name<input name="name" maxLength={120} defaultValue={editing?.name ?? ""} required autoFocus/></label>
        <div className="studio-field-pair">
          <label>Frames<input type="number" name="frames" min="1" max="36000" defaultValue={editing?.frameCount ?? 24} required/></label>
          <label>FPS<input type="number" name="fps" min="1" max="120" defaultValue={editing?.fps ?? 24} required/></label>
        </div>
      </>}
      <div className="studio-clip-actions">
        <button className="studio-save" disabled={busy}>{deleting ? "Delete clip" : editing ? "Save clip" : "Add clip"}</button>
        <button type="button" disabled={busy} onClick={() => { setEditor(null); setDeleting(null); setError(""); }}>Cancel</button>
      </div>
    </form>}
  </Dialog>;
}
