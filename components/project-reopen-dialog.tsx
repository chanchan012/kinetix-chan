"use client";

import { useState,type FormEvent } from "react";
import { Dialog } from "./dialog";
import { archiveBase64 } from "@/lib/import/archive-base64";
import { projectArchiveByteLimit,type ProjectReopenReceipt } from "@/lib/project/archive-options";

export function ProjectReopenDialog({close,opened}:{close:()=>void;opened:(id:string)=>void}) {
  const [file,setFile]=useState<File>();
  const [name,setName]=useState("");
  const [preview,setPreview]=useState<{archive:string;receipt:ProjectReopenReceipt}>();
  const [busy,setBusy]=useState<"checking"|"opening"|null>(null);
  const [error,setError]=useState("");

  async function send(input:{archive:string;name?:string;importId:string;preflight:boolean}) {
    const response=await fetch("/api/rigs/project-archive",{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input),
    });
    if (!response.ok) {
      const failure=await response.json().catch(()=>null);
      throw new Error(failure?.message ?? "Could not open this project archive.");
    }
    return await response.json() as ProjectReopenReceipt;
  }

  async function check(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !file) return;
    setError("");
    setPreview(undefined);
    if (file.size>projectArchiveByteLimit) {setError("Choose a project ZIP of 2 MiB or less.");return;}
    setBusy("checking");
    try {
      const archive=archiveBase64(new Uint8Array(await file.arrayBuffer()));
      const receipt=await send({archive,name:name.trim() || undefined,importId:crypto.randomUUID(),preflight:true});
      setPreview({archive,receipt});
    } catch (failure) {setError(failure instanceof Error ? failure.message : "Could not check this project archive.");}
    finally {setBusy(null);}
  }

  async function reopen() {
    if (!preview || busy) return;
    setBusy("opening");
    setError("");
    try {
      const {projectId}=await send({archive:preview.archive,name:preview.receipt.name,importId:preview.receipt.importId,preflight:false});
      opened(projectId);
    } catch (failure) {setError(failure instanceof Error ? failure.message : "Could not reopen the project.");}
    finally {setBusy(null);}
  }

  return <Dialog title="Open project archive" className="library-modal" onClose={()=>{if (!busy) close();}}>
    <form onSubmit={check}>
      <label>Project ZIP<input type="file" accept=".zip,application/zip" disabled={Boolean(busy)} onChange={event=>{
        setFile(event.target.files?.[0]);setPreview(undefined);setError("");
      }}/></label>
      <label>Project name<input maxLength={120} placeholder="Use the archived project name" value={name} disabled={Boolean(busy)}
        onChange={event=>{setName(event.target.value);setPreview(undefined);setError("");}}/></label>
      <button type="submit" disabled={!file || Boolean(busy)}>Check archive</button>
      {busy && <p role="status">{busy==="checking" ? "Checking source and clip revisions…" : "Opening the project…"}</p>}
      {error && <p role="alert">{error}</p>}
      {preview && <section aria-label="Project archive preview">
        <h3>{preview.receipt.name}</h3>
        <p>{preview.receipt.artboard.width} × {preview.receipt.artboard.height} px · {preview.receipt.parts} paths · {preview.receipt.drawings} drawing layers</p>
        <p>{preview.receipt.clips.length} saved clips</p>
        {preview.receipt.clips.length>0 && <ul>{preview.receipt.clips.map(clip=><li key={clip.id}>{clip.name} · {clip.frameCount} frames at {clip.fps} fps</li>)}</ul>}
        {preview.receipt.images>0 && <p>{preview.receipt.images} image assets</p>}
        {preview.receipt.missingImages.length>0 && <>
          <p>Open the project and relink these files under Image assets.</p>
          <ul>{preview.receipt.missingImages.map(image=><li key={image.id}>{image.name}</li>)}</ul>
        </>}
        {preview.receipt.warnings.map(message=><p key={message}>{message}</p>)}
        <p>This opens a new private project in your library.</p>
      </section>}
      <button className="primary" type="button" onClick={()=>void reopen()} disabled={!preview || Boolean(busy)}>Open as new project</button>
    </form>
  </Dialog>;
}
