"use client";

import { useState,type FormEvent } from "react";
import type { ProjectArchiveSummary } from "@/lib/project/archive-options";
import type { ClipTiming } from "./timeline";

export function ProjectArchiveForm({rigId,revision,clips,unsaved}:{rigId:string;revision:number;clips:ClipTiming[];unsaved:boolean}) {
  const [pending,setPending]=useState(false);
  const [message,setMessage]=useState("");
  const [checked,setChecked]=useState<{key:string;summary:ProjectArchiveSummary;byteCount:number}>();
  const pins=clips.map(({id,trackRevision})=>({id,trackRevision}));
  const key=JSON.stringify({revision,clips:pins});
  const preview=checked?.key===key ? checked : undefined;

  async function send(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || unsaved) return;
    const form=event.currentTarget;
    const preflight=((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null)?.value==="check";
    setPending(true);
    setMessage("");
    try {
      const response=await fetch(`/api/rigs/${rigId}/project-archive`,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({revision,clips:pins,preflight})});
      if (!response.ok) {
        const failure=await response.json().catch(()=>null);
        throw new Error(failure?.message ?? "Could not prepare the project archive.");
      }
      if (preflight) {
        const {summary,byteCount}=await response.json() as {summary:ProjectArchiveSummary;byteCount:number};
        setChecked({key,summary,byteCount});
      } else {
        const url=URL.createObjectURL(await response.blob());
        const link=document.createElement("a");
        link.href=url;
        link.download=`kinetix-${rigId}.kinetix.zip`;
        link.hidden=true;
        form.appendChild(link);
        try {link.click();}
        finally {link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
        setMessage("Project archive downloaded.");
      }
    } catch (error) {setMessage(error instanceof Error ? error.message : "Could not prepare the project archive.");}
    finally {setPending(false);}
  }

  return <form onSubmit={send} aria-label="Project archive">
    <p>Save editable artwork and all {clips.length} clips in one ZIP. Open it from the rig library.</p>
    {unsaved && <p>Save artwork and key changes before exporting.</p>}
    {preview && <section aria-label="Project archive preflight">
      <p>{preview.summary.clips.length} saved clips · {(preview.byteCount/1024).toFixed(1)} KiB</p>
      {preview.summary.missingImages.length>0 && <p>{preview.summary.missingImages.length} missing images can be relinked after reopening.</p>}
      {preview.summary.warnings.map(warning=><p key={warning}>{warning}</p>)}
    </section>}
    {pending && <p role="status">Preparing saved project…</p>}
    {message && <p role="status">{message}</p>}
    <div className="studio-field-pair">
      <button type="submit" value="check" disabled={pending || unsaved}>Check archive</button>
      <button type="submit" className="studio-save" value="download" disabled={pending || unsaved}>Download project archive</button>
    </div>
  </form>;
}
