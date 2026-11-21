"use client";

import { useState } from "react";
import { Dialog } from "../dialog";
import { maxSequenceBytes,maxSequenceFrames,type AtlasImportInput,type AtlasReceipt,type SequenceImportInput,type SequenceReceipt } from "@/lib/import/sequence-options";

export type RasterImportMode="png-sequence"|"sprite-bundle";
type ImportInput=SequenceImportInput|AtlasImportInput;
type Receipt=SequenceReceipt|AtlasReceipt;

async function archiveInput(files:File[]) {
  if (!files.length || files.length>maxSequenceFrames) throw new Error("Choose one ZIP or up to 150 PNG files.");
  if (files.reduce((bytes,file)=>bytes+file.size,0)>maxSequenceBytes) throw new Error("Choose 2 MiB or less of sequence files.");
  if (files.length===1 && /\.zip$/i.test(files[0].name)) return new Uint8Array(await files[0].arrayBuffer());
  const names=new Set(files.map(file=>file.name.toLowerCase()));
  if (names.size!==files.length || files.some(file=>!/\.png$/i.test(file.name))) {
    throw new Error("Choose one sequence ZIP or PNG frames with unique file names.");
  }
  const {zipSync}=await import("fflate");
  const pngs=await Promise.all(files.map(async file=>[file.name,new Uint8Array(await file.arrayBuffer())] as const));
  const zip=zipSync(Object.fromEntries(pngs),{level:0});
  if (zip.length>maxSequenceBytes) throw new Error("The assembled PNG sequence exceeds 2 MiB.");
  return zip;
}

function base64(bytes:Uint8Array) {
  const chunks=[];
  for (let offset=0;offset<bytes.length;offset+=32_768) chunks.push(String.fromCharCode(...bytes.subarray(offset,offset+32_768)));
  return btoa(chunks.join(""));
}

export function SequenceImportDialog({mode,revision,emptyArtboard,applyBlocked,check,apply,close}:{
  mode:RasterImportMode;revision:number;emptyArtboard:boolean;applyBlocked:boolean;
  check:(input:ImportInput)=>Promise<Receipt>;apply:(input:ImportInput)=>Promise<void>;close:()=>void;
}) {
  const atlas=mode==="sprite-bundle";
  const kind=atlas ? "Sprite bundle" : "PNG sequence";
  const [files,setFiles]=useState<File[]>([]);
  const [name,setName]=useState(kind);
  const [fps,setFps]=useState(24);
  const [resize,setResize]=useState(false);
  const [review,setReview]=useState<{input:ImportInput;receipt:Receipt}>();
  const [busy,setBusy]=useState<"checking"|"saving"|null>(null);
  const [error,setError]=useState("");
  const ready=review?.receipt.revision===revision;

  function invalidate() {setReview(undefined);setError("");}

  async function preflight() {
    invalidate();
    setBusy("checking");
    try {
      if (atlas && (files.length!==1 || !/\.zip$/i.test(files[0].name))) throw new Error("Choose one Kinetix sprite bundle ZIP.");
      const input={archive:base64(await archiveInput(files)),revision,name:name.trim() || kind,...(!atlas && {fps}),
        resizeArtboard:emptyArtboard && resize,importId:crypto.randomUUID(),preflight:true};
      setReview({input,receipt:await check(input)});
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not check this import.");
    } finally {setBusy(null);}
  }

  async function commit() {
    if (!review || !ready || applyBlocked) return;
    setError("");
    setBusy("saving");
    try {await apply({...review.input,preflight:false});}
    catch (error) {setError(error instanceof Error ? error.message : "Could not save this import.");}
    finally {setBusy(null);}
  }

  return <Dialog title={atlas ? "Import sprite bundle" : "Import PNG sequence"} className="studio-easing studio-export studio-sequence-import"
    onClose={()=>{if (!busy) close();}}>
    <form onSubmit={event=>{event.preventDefault();void preflight();}}>
      <fieldset disabled={Boolean(busy)}>
        <label>{atlas ? "Sprite bundle ZIP" : "ZIP or numbered PNG files"}<input type="file"
          accept={atlas ? ".zip,application/zip" : ".zip,.png,image/png,application/zip"} multiple={!atlas} onChange={event=>{
          const next=Array.from(event.target.files ?? []);
          setFiles(next);
          if (next[0]) setName(next[0].name.replace(atlas ? /\.zip$/i : /(?:\d+)?\.(?:zip|png)$/i,"").trim().slice(0,120) || kind);
          invalidate();
        }}/></label>
        <label>{atlas ? "Drawing layer name" : "Clip and layer name"}<input value={name} maxLength={120} onChange={event=>{setName(event.target.value);invalidate();}}/></label>
        {!atlas && <label>Frame rate without a manifest<input type="number" min={1} max={120} required value={Number.isNaN(fps) ? "" : fps}
          onChange={event=>{setFps(event.target.valueAsNumber);invalidate();}}/></label>}
        {emptyArtboard && <label className="studio-sequence-fit"><input type="checkbox" checked={resize}
          onChange={event=>{setResize(event.target.checked);invalidate();}}/>Match the empty artboard to the images</label>}
      </fieldset>
      <button type="submit" disabled={Boolean(busy) || !files.length}>{atlas ? "Check bundle" : "Check sequence"}</button>
      {busy && <p role="status">{busy==="checking" ? "Reading frames…" : "Saving clips and the drawing layer…"}</p>}
      {error && <p role="alert">{error}</p>}
      {review && <section className="studio-sequence-review" aria-label={kind+" preview"}>
        {"clips" in review.receipt ? <>
          <p role="status">{review.receipt.clips.length} clips · {review.receipt.width} × {review.receipt.height} px · {review.receipt.layout}</p>
          <ul>{review.receipt.clips.map(clip=><li key={clip.id}>
            {clip.name}{clip.direction && ` · ${clip.direction}`} · {clip.frameCount} ticks at {clip.fps} fps · {clip.loopMode}
          </li>)}</ul>
          <p>{review.receipt.celCount} editable cels · {review.receipt.blankFrames} transparent source frames</p>
        </> : <>
          <p role="status">{review.receipt.frameCount} frames at {review.receipt.fps} fps · {review.receipt.width} × {review.receipt.height} px</p>
          <p>{review.receipt.celCount} editable cels · {review.receipt.heldFrames} repeated frames · {review.receipt.blankFrames} transparent frames</p>
          <p>Source frames {review.receipt.sourceStartFrame}–{review.receipt.sourceEndFrame} start at the beginning of the new clip.</p>
        </>}
        {review.receipt.previewPng && <img src={`data:image/png;base64,${review.receipt.previewPng}`} alt="First visible frame"/>}
        {review.receipt.notes.map(note=><p key={note}>{note}</p>)}
        {!ready ? <p>Studio changed. Check the import again.</p> : applyBlocked ? <p>Finish saving Studio changes before importing.</p> :
          <p>Import saves {atlas ? "the clips" : "the clip"} and layer together and starts a fresh undo history.</p>}
      </section>}
      <button type="button" className="studio-save" onClick={()=>void commit()} disabled={Boolean(busy) || !ready || applyBlocked}>
        {atlas ? "Import and create clips" : "Import and create clip"}
      </button>
    </form>
  </Dialog>;
}
