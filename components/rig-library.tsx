"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowUpRight";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";
import { UserButton } from "@clerk/nextjs";
import { Brand } from "./brand";
import { ArtCanvas } from "./art-canvas";
import { studies, studyFor } from "@/lib/studies";
import type { Study } from "@/lib/studies";

type Rig = {id:string; name:string; state:{study?:string}};
type Clip = {id:string; name:string; fps:number; frameCount:number; thumbnail:string|null};
async function request<T>(path:string,method="GET",body?:object):Promise<T> {
  const response = await fetch("/api/"+path,{method,cache:"no-store",headers:body?{"content-type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});
  if (!response.ok) {
    if(response.status === 401) {
      window.location.replace("/sign-in?redirect_url=%2Fdashboard");
      throw Error("Your session has expired.");
    }
    if(response.status === 404) throw Error("This item no longer exists. Refresh your library.");
    if(response.status === 429) throw Error("Too many requests. Try again in a moment.");
    throw Error("The library could not complete this request. Please try again.");
  }
  return response.status===204 ? undefined as T : response.json();
}
function Modal({title,close,children}:{title:string;close:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const el=ref.current!;el.showModal();return ()=>el.close();},[]);
  return <dialog className="library-modal" ref={ref} onCancel={close} aria-label={title}>
    <header><h2>{title}</h2><button aria-label="Close dialog" onClick={close}>×</button></header>{children}</dialog>;
}
function Art({study}:{study:Study}) {
  return <span className="library-art" style={{backgroundColor:study.wash}}><ArtCanvas study={study} mini/></span>;
}
function useAction() {
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const locked=useRef(false);
  async function run(fn:()=>Promise<void>) {
    if(locked.current) return;
    locked.current=true;setBusy(true);setError("");
    try {await fn();} catch(e) {setError(e instanceof Error?e.message:"Request failed.");}
    finally {locked.current=false;setBusy(false);}
  }
  return {error,busy,run};
}
function CreateRig({created,close}:{created:(rig:Rig)=>void;close:()=>void}) {
  const {error,busy,run}=useAction();
  function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fields=new FormData(e.currentTarget);
    void run(async()=>created(await request<Rig>("rigs","POST",{name:fields.get("name"),study:fields.get("study")})));
  }
  return <Modal title="New rig" close={close}><form onSubmit={submit}>
    <label>Rig name<input name="name" required maxLength={120} autoFocus/></label>
    <label>Character<select name="study">{studies.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    {error && <p role="alert">{error}</p>}<button className="primary" disabled={busy}>Create rig</button>
  </form></Modal>;
}
function RigDetail({rig,change,remove,close}:{rig:Rig;change:(r:Rig)=>void;remove:()=>void;close:()=>void}) {
  const [clips,setClips]=useState<Clip[]|null>(null);
  const [loadError,setLoadError]=useState("");
  const [editing,setEditing]=useState<Clip|null>(null);
  const [retry,setRetry]=useState(0);
  const path="rigs/"+rig.id;
  const {error,busy,run}=useAction();
  useEffect(()=>{
    let alive=true;
    let timer:ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const rows=await request<Clip[]>(path+"/clips");
        if(!alive)return;
        setClips(rows);setLoadError("");
        if(rows.some(c=>!c.thumbnail))timer=setTimeout(refresh,30000);
      } catch {if(alive)setLoadError("Could not load clips.");}
    }
    void refresh();
    return ()=>{alive=false;clearTimeout(timer);};
  },[path,retry]);
  function saveClip(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();const form=e.currentTarget;const fields=new FormData(form);
    void run(async()=>{
      await request(path+"/clips"+(editing?"/"+editing.id:""),editing?"PATCH":"POST",{
        name:fields.get("name"),fps:Number(fields.get("fps")),frameCount:Number(fields.get("frames"))
      });
      setEditing(null);form.reset();setRetry(n=>n+1);
    });
  }
  return <Modal title={rig.name} close={close}>
    <form onSubmit={e=>{e.preventDefault();const name=new FormData(e.currentTarget).get("name");void run(async()=>change(await request<Rig>(path,"PATCH",{name})));}}>
      <label>Rig name<input name="name" defaultValue={rig.name} required maxLength={120}/></label>
      <div className="actions"><Link className="primary" href={"/studio/"+rig.id} prefetch={false}>Open studio</Link><button disabled={busy}>Save name</button><button type="button" disabled={busy} onClick={()=>{
        if(window.confirm("Delete this rig and all its animation clips?"))void run(async()=>{await request(path,"DELETE");remove();});
      }}>Delete rig</button></div>
    </form>
    <h3>Animation clips</h3>
    {loadError ? <p role="alert">{loadError} <button onClick={()=>setRetry(n=>n+1)}>Retry</button></p> :
      clips===null ? <p>Loading clips…</p> : clips.length===0 ? <p>Add your first animation clip below.</p> :
      <ul>{clips.map(c=><li key={c.id}>{c.thumbnail && <img src={c.thumbnail} alt="" width="56" height="32"/>}
        <span><strong>{c.name}</strong><small>{c.frameCount} frames · {c.fps} fps</small></span>
        <button disabled={busy} onClick={()=>setEditing(c)} aria-label={"Edit "+c.name}>Edit</button>
        <button disabled={busy} aria-label={"Delete "+c.name} onClick={()=>{
          if(window.confirm("Delete this animation clip?"))void run(async()=>{await request(path+"/clips/"+c.id,"DELETE");if(editing?.id===c.id)setEditing(null);setRetry(n=>n+1);});
        }}>Delete</button></li>)}</ul>}
    <form key={editing?.id??"new"} onSubmit={saveClip}>
      <label>Clip name<input name="name" required maxLength={120} defaultValue={editing?.name??""}/></label>
      <div className="clip-timing"><label>Frames<input type="number" name="frames" required min="1" max="36000" defaultValue={editing?.frameCount??24}/></label>
      <label>FPS<input type="number" name="fps" required min="1" max="120" defaultValue={editing?.fps??24}/></label></div>
      <div className="actions"><button className="primary" disabled={busy}>{editing?"Save clip":"Add clip"}</button>
      {editing&&<button type="button" onClick={()=>setEditing(null)}>Cancel edit</button>}</div>
    </form>{error&&<p role="alert">{error}</p>}
  </Modal>;
}
export function RigLibrary() {
  const [loading,setLoading]=useState(true);
  const [rigs,setRigs]=useState<Rig[]>([]);
  const [error,setError]=useState("");
  const [selected,setSelected]=useState<string|null>(null);
  const [creating,setCreating]=useState(false);
  const selectedRig=rigs.find(r=>r.id===selected);
  const refresh=useCallback(async()=>{
    setError("");
    try {
      setRigs(await request<Rig[]>("rigs"));
      setLoading(false);
    } catch(e){setError(e instanceof Error?e.message:"Could not load library.");}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  return <div className="app-shell"><header className="topbar"><Brand/><span className="brand-divider"/><span className="studio-name">Motion Studio</span>
    <nav aria-label="Account"><UserButton/></nav></header>
    <main className="dashboard"><div className="dashboard-content"><div className="library-heading"><div><h1>Rig library</h1>
      <p>Manage your character rigs and animation clips.</p></div>
      <button className="primary" onClick={()=>setCreating(true)}><PlusIcon/>New rig</button></div>
      {error&&<p role="alert">{error} <button onClick={()=>void refresh()}>Retry</button></p>}
      {loading&&!error&&<p role="status">Loading library…</p>}
      {!loading&&<section><h2>Your rigs</h2>{rigs.length===0?<p className="empty-library">Create a rig to start your collection.</p>:<div className="rig-grid">
        {rigs.map(r=><button className="rig-card" key={r.id} onClick={()=>setSelected(r.id)}><Art study={studyFor(r.state.study)}/><span><strong>{r.name}</strong><small>Manage rig and clips</small></span></button>)}</div>}</section>}
      <section><h2>Motion studies</h2><div className="rig-grid">{studies.map(s=><Link key={s.id} href={"/studio/studies/"+s.id} className="rig-card">
        <Art study={s}/><span><strong>{s.name}</strong><small>{s.clip} · {s.frames} frames</small><ArrowUpRightIcon/></span></Link>)}</div></section>
    </div></main>
    {creating&&<CreateRig close={()=>setCreating(false)} created={r=>{setRigs(rows=>[r,...rows]);setCreating(false);setSelected(r.id);}}/>}
    {selectedRig&&<RigDetail key={selectedRig.id} rig={selectedRig} close={()=>setSelected(null)} change={r=>setRigs(rows=>[r,...rows.filter(row=>row.id!==r.id)])}
      remove={()=>{setRigs(rows=>rows.filter(row=>row.id!==selected));setSelected(null);}}/>}
  </div>;
}
