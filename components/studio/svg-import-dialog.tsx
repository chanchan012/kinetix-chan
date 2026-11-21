"use client";

import { useEffect,useRef,useState } from "react";
import { Dialog } from "../dialog";
import { editRig } from "@/lib/rig/commands";
import { artboardFor,type KinetixRigState } from "@/lib/rig/model";
import { drawRigArtwork } from "@/lib/rig/render";
import { evaluateRig } from "@/lib/rig/kinematics";
import type { SvgImportPlan } from "@/lib/rig/svg-import";

export function SvgImportDialog({rig,apply,close}:{rig:KinetixRigState;apply:(plan:SvgImportPlan)=>boolean;close:()=>void}) {
  const request=useRef(0);
  const [file,setFile]=useState<File>();
  const [fit,setFit]=useState(false);
  const [review,setReview]=useState<{plan:SvgImportPlan;result?:KinetixRigState}>();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const plan=review?.plan;

  async function preview(file:File|undefined,fit:boolean) {
    const run=++request.current;
    setReview(undefined);
    setError("");
    setBusy(Boolean(file));
    if (!file) return;
    try {
      const {planSvgImport,svgImportByteLimit}=await import("@/lib/rig/svg-import");
      if (file.size>svgImportByteLimit) throw new Error("Choose an SVG of 512 KB or less.");
      const bytes=await file.arrayBuffer();
      if (run!==request.current) return;
      const source=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
      const plan=planSvgImport(source,{name:file.name.replace(/\.svg$/i,""),importId:crypto.randomUUID(),
        fit:fit ? artboardFor(rig) : undefined});
      const result=plan.commands.length ? editRig(rig,plan.commands)[0] : undefined;
      setReview({plan,result});
    } catch (error) {
      if (run!==request.current) return;
      const message=error instanceof Error ? error.message.split("\n")[0] : "Could not read this SVG.";
      setError(message.startsWith("[") ? "The artwork exceeds this document’s editable layer or path limits." : message);
    } finally {
      if (run===request.current) setBusy(false);
    }
  }

  return <Dialog title="Import SVG" className="studio-easing studio-export studio-svg-import" onClose={close}>
    <form onSubmit={event=>{
      event.preventDefault();
      if (plan?.commands.length && !apply(plan)) setError("The document changed. Review the file again before importing.");
    }}>
      <label>SVG file<input type="file" accept=".svg,image/svg+xml" onChange={event=>{
        const next=event.target.files?.[0];
        setFile(next);
        void preview(next,fit);
      }}/></label>
      <label className="studio-svg-fit"><input type="checkbox" checked={fit} onChange={event=>{
        setFit(event.target.checked);
        void preview(file,event.target.checked);
      }}/>Fit within the artboard</label>
      {busy && <p role="status">Reading SVG artwork…</p>}
      {error && <p role="alert">{error}</p>}
      {plan && <section aria-label="SVG import preview" className="studio-svg-review">
        <p role="status">{plan.partCount ? `${plan.partCount} editable ${plan.partCount===1 ? "path" : "paths"} · ${plan.viewport.width} × ${plan.viewport.height} px` :
          "No supported editable artwork found."}</p>
        {review?.result && <SvgPreview rig={review.result} groupId={plan.groupId}/>}
        {plan.diagnostics.length>0 && <>
          <h3>Import notes</h3>
          <ul>{plan.diagnostics.map(({element,line,message},index)=><li key={index}><strong>{element} · line {line}</strong> {message}</li>)}</ul>
          {plan.additionalDiagnostics>0 && <p>{plan.additionalDiagnostics} more notes for this file.</p>}
        </>}
      </section>}
      <button className="studio-save" disabled={busy || !plan?.commands.length}>Import editable artwork</button>
    </form>
  </Dialog>;
}

function SvgPreview({rig,groupId}:{rig:KinetixRigState;groupId:string}) {
  const canvas=useRef<HTMLCanvasElement>(null);
  const {width,height}=artboardFor(rig);
  const scale=Math.min(640/width,280/height);
  const pixelWidth=Math.max(1,Math.round(width*scale));
  const pixelHeight=Math.max(1,Math.round(height*scale));
  useEffect(()=>{
    const context=canvas.current?.getContext("2d");
    if (!context) return;
    context.setTransform(pixelWidth/width,0,0,pixelHeight/height,0,0);
    context.clearRect(0,0,width,height);
    drawRigArtwork(context,rig,evaluateRig(rig),0,false,groupId);
  },[rig,groupId,width,height,pixelWidth,pixelHeight]);
  return <canvas ref={canvas} width={pixelWidth} height={pixelHeight} role="img" aria-label="Imported SVG preview"/>;
}
