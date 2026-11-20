"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, DotsThree, FilmSlate, Polygon, Plus } from "@phosphor-icons/react";
import { UserButton } from "@clerk/nextjs";
import { Brand } from "./brand";
import { ArtCanvas } from "./art-canvas";
import { Dialog } from "./dialog";
import { ArtboardFields, readArtboardFields } from "./artboard-fields";
import { defaultArtboard } from "@/lib/rig/model";
import { studies, studyFor, type Study } from "@/lib/studies";

type Rig = { id: string; name: string; state: {study?: string | null}; owned?: boolean };
type LibraryDialog = "create" | "design" | "studies" | { action: "rename" | "delete"; rig: Rig } | null;

async function request<T>(path: string, method = "GET", body?: object): Promise<T> {
  const response = await fetch("/api/" + path, {
    method, cache: "no-store", headers: body ? {"Content-Type":"application/json"} : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    if (response.status === 401) {
      window.location.replace("/sign-in?redirect_url=%2Fdashboard");
      throw Error("Your session has expired.");
    }
    if (response.status === 404) throw Error("This rig no longer exists. Refresh your library.");
    if (response.status === 429) throw Error("Too many requests. Try again in a moment.");
    throw Error("The library could not complete this request. Try again.");
  }
  return response.status === 204 ? undefined as T : response.json();
}

function Art({study}: {study: Study}) {
  return <span className="library-art" style={{backgroundColor:study.wash}}><ArtCanvas study={study} mini/></span>;
}

function RigActions({rig, choose}: {rig: Rig; choose: (action: "rename" | "delete") => void}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent | FocusEvent) {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("focusin", closeOutside);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("focusin", closeOutside);
    };
  }, [open]);

  return <div ref={menu} className="rig-actions" onKeyDown={event => {
    if (open && event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
  }}>
    <button ref={trigger} className="rig-actions-trigger" type="button" aria-label={"Actions for " + rig.name}
      aria-expanded={open} onClick={() => setOpen(value => !value)}><DotsThree size={22} weight="bold"/></button>
    {open && <div className="rig-actions-list">
      <button type="button" onClick={() => { trigger.current?.focus(); setOpen(false); choose("rename"); }}>Rename rig</button>
      <button type="button" onClick={() => { trigger.current?.focus(); setOpen(false); choose("delete"); }}>Delete rig</button>
    </div>}
  </div>;
}

export function RigLibrary() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rigs, setRigs] = useState<Rig[]>([]);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<LibraryDialog>(null);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    setError("");
    try {
      setRigs(await request<Rig[]>("rigs"));
      setLoading(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load the rig library.");
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  function show(next: LibraryDialog) {
    setActionError("");
    setDialog(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !dialog || dialog === "studies") return;
    const values = new FormData(event.currentTarget);
    pending.current = true;
    setBusy(true);
    setActionError("");
    try {
      if (dialog === "create" || dialog === "design") {
        const source = dialog === "design" ? { artboard: readArtboardFields(values) } : { study: values.get("study") };
        const rig = await request<Rig>("rigs", "POST", {name: values.get("name"), ...source});
        setRigs(rows => [rig, ...rows]);
        router.push("/studio/" + rig.id);
      } else if (dialog.action === "rename") {
        const renamed = await request<Rig>("rigs/" + dialog.rig.id, "PATCH", {name: values.get("name")});
        setRigs(rows => rows.map(rig => rig.id === renamed.id ? {...rig, ...renamed} : rig));
      } else {
        await request("rigs/" + dialog.rig.id, "DELETE");
        setRigs(rows => rows.filter(rig => rig.id !== dialog.rig.id));
      }
      setDialog(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not save the rig.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const action = typeof dialog === "object" ? dialog : null;
  const title = dialog === "design" ? "New design" : dialog === "create" ? "New rig" : action?.action === "rename" ? "Rename rig" : "Delete rig";

  return <div className="app-shell">
    <header className="topbar"><Brand/><span className="brand-divider"/><span className="studio-name">Motion Studio</span>
      <nav aria-label="Account"><UserButton/></nav>
    </header>
    <main className="dashboard"><div className="dashboard-content">
      <div className="library-heading"><div><h1>Rig library</h1><p>Open a rig to work on its animation in Studio.</p></div>
        <div className="library-heading-actions">
          <button className="library-secondary" onClick={() => show("studies")}><FilmSlate size={17}/>Motion studies</button>
          <button className="library-secondary" onClick={() => show("create")}><Plus size={17}/>New rig</button>
          <button className="primary" onClick={() => show("design")}><Polygon size={17}/>New design</button>
        </div>
      </div>
      {error && <p role="alert">{error} <button onClick={() => void refresh()}>Retry</button></p>}
      {loading && !error && <p role="status">Loading library…</p>}
      {!loading && <section aria-label="Your rigs">
        <h2>Your rigs</h2>
        {rigs.length === 0 ? <p className="empty-library">Create a rig to start your collection.</p> :
          <div className="rig-grid">{rigs.map(rig => <article className="rig-card-shell" key={rig.id}>
            <Link className="rig-card" prefetch={false} href={"/studio/" + rig.id}>
              {rig.state.study === null ? <span className="library-art library-design-art"><Polygon size={42}/></span> :
                <Art study={studyFor(rig.state.study)}/>}
              <span><strong>{rig.name}</strong>{rig.owned === false && <small>Shared rig</small>}<ArrowUpRight size={16}/></span>
            </Link>
            {rig.owned !== false && <RigActions rig={rig} choose={action => show({action, rig})}/>}
          </article>)}</div>}
      </section>}
    </div></main>
    {dialog === "studies" && <Dialog title="Motion studies" className="library-modal library-studies" onClose={() => show(null)}>
      <div className="rig-grid">{studies.map(study => <Link key={study.id} href={"/studio/studies/" + study.id}
        className="rig-card" onClick={() => show(null)} prefetch={false}>
        <Art study={study}/><span><strong>{study.name}</strong><small>{study.clip} · {study.frames} frames</small><ArrowUpRight size={16}/></span>
      </Link>)}</div>
    </Dialog>}
    {(dialog === "create" || dialog === "design" || action) && <Dialog title={title} className="library-modal" onClose={() => { if (!pending.current) show(null); }}>
      <form onSubmit={submit}>
        {action?.action === "delete" ?
          <p>Delete <strong>{action.rig.name}</strong> and all its animation clips?</p> :
          <label>{dialog === "design" ? "Design name" : "Rig name"}<input name="name" defaultValue={action?.rig.name ?? ""} required maxLength={120} autoFocus/></label>}
        {dialog === "design" && <ArtboardFields artboard={defaultArtboard}/>}
        {dialog === "create" && <label>Character<select name="study">
          {studies.map(study => <option key={study.id} value={study.id}>{study.name}</option>)}
        </select></label>}
        {actionError && <p role="alert">{actionError}</p>}
        <button className={action?.action === "delete" ? "primary library-delete" : "primary"} disabled={busy}>
          {dialog === "design" ? "Create design" : dialog === "create" ? "Create rig" : action?.action === "rename" ? "Save name" : "Delete rig"}
        </button>
      </form>
    </Dialog>}
  </div>;
}
