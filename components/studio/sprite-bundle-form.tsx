"use client";

import { useRef, useState, type FormEvent } from "react";
import { spriteBundleRequest, type SpriteBundleRequest } from "@/lib/export/sprite-bundle-options";
import type { Artboard } from "@/lib/rig/model";
import type { ClipTiming } from "./timeline";

type Plan = {textureBytes:number;files:{file:string;width:number;height:number}[];clips:{id:string;name:string;frames:unknown[]}[]};
const errors:Record<string,string>={
  revision_conflict:"A saved revision changed. Reopen Export after the studio updates.",
  unsupported_range:"Choose valid frame ranges or a smaller pixel scale.",
  frame_exceeds_texture_size:"At least one frame exceeds the maximum texture size. Increase the limit or reduce the pixel scale.",
  atlas_too_large:"The texture pages exceed the export limit. Shorten the ranges or reduce the pixel scale.",
  package_too_large:"The ZIP exceeds the download limit. Shorten the ranges or choose a smaller scale.",
  not_found:"A selected clip is no longer available in this project.",
};

export function SpriteBundleForm({path,rigId,revision,clips,activeId,artboard,unsaved}:{
  path:string;rigId:string;revision:number;clips:ClipTiming[];activeId?:string;artboard:Artboard;unsaved:boolean;
}) {
  const [selected,setSelected]=useState<string[]>(()=>[activeId || clips[0]?.id].filter(Boolean));
  const [layout,setLayout]=useState<SpriteBundleRequest["layout"]>("packed");
  const [pending,setPending]=useState(false);
  const [message,setMessage]=useState("");
  const [plan,setPlan]=useState<Plan|null>(null);
  const settingsVersion=useRef(0);
  const primary=activeId || clips[0]?.id;

  async function send(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || unsaved || !selected.length) return;
    const submitter=(event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null;
    const preflight=submitter?.value==="check";
    const version=settingsVersion.current;
    const form=event.currentTarget;
    const fields=new FormData(form);
    const numeric=(key:string)=>Number(fields.get(key));
    const pivot={x:numeric("pivotX"),y:numeric("pivotY")};
    setMessage("");
    try {
      const requestedClips=clips.filter(clip=>selected.includes(clip.id)).map(clip=>{
        const metadata=String(fields.get("metadata-"+clip.id) ?? "").trim();
        const direction=String(fields.get("direction-"+clip.id) ?? "").trim() || undefined;
        let frames:unknown;
        if (metadata) {
          try { frames=JSON.parse(metadata); }
          catch { throw new Error("Frame metadata for "+clip.name+" must be a JSON array."); }
        }
        return {id:clip.id,trackRevision:clip.trackRevision,startFrame:numeric("start-"+clip.id)-1,
          endFrame:numeric("end-"+clip.id)-1,loopMode:fields.get("loop-"+clip.id),direction,pivot,frames};
      });
      const parsed=spriteBundleRequest.safeParse({
        revision,layout,clips:requestedClips,scale:numeric("scale"),maxTextureSize:numeric("maximum"),
        filter:fields.get("filter"),colorSpace:fields.get("color"),alpha:fields.get("alpha"),preflight,
        ...(layout==="packed" && {packing:{trim:fields.has("trim"),padding:numeric("padding"),
          extrusion:numeric("extrusion"),rotate:fields.has("rotate")}}),
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the sprite bundle settings.");
      setPending(true);
      const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(parsed.data)});
      if (!response.ok) {
        const problem=await response.json().catch(()=>null);
        throw new Error(errors[problem?.error] ?? problem?.detail ?? "Could not export the sprite bundle.");
      }
      if (preflight) {
        const next=await response.json();
        if (version===settingsVersion.current) setPlan(next);
      } else {
        const url=URL.createObjectURL(await response.blob());
        const link=document.createElement("a");
        link.href=url;
        link.download="kinetix-"+rigId+"-sprites.zip";
        link.hidden=true;
        form.appendChild(link);
        try { link.click(); }
        finally {
          link.remove();
          setTimeout(()=>URL.revokeObjectURL(url),1000);
        }
        setMessage("Sprite bundle downloaded.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not export the sprite bundle.");
    } finally {
      setPending(false);
    }
  }

  return <form onSubmit={send} onChange={()=>{settingsVersion.current++;setPlan(null);}}>
    <label>Sprite layout<select value={layout} onChange={event=>setLayout(event.target.value as typeof layout)}>
      <option value="packed">Packed atlas pages</option>
      <option value="fixed-grid">Fixed-grid sheets</option>
      <option value="loose">Loose PNG frames</option>
    </select></label>
    <fieldset className="studio-bundle-clips" disabled={pending}>
      <legend>Clip ranges</legend>
      {clips.map(clip=>{
        const enabled=selected.includes(clip.id);
        return <div key={clip.id} className="studio-bundle-clip">
          <label className="studio-check"><input type="checkbox" checked={enabled} onChange={event=>
            setSelected(current=>event.target.checked ? [...current,clip.id] : current.filter(id=>id!==clip.id))}/>
            {clip.name}
          </label>
          {enabled && <>
            <div className="studio-field-pair">
              <label>First frame<input type="number" name={"start-"+clip.id} min={1} max={clip.frameCount} defaultValue={1} required/></label>
              <label>Last frame<input type="number" name={"end-"+clip.id} min={1} max={clip.frameCount}
                defaultValue={Math.min(clip.frameCount,clip.id===primary ? 96 : 24)} required/></label>
            </div>
            <div className="studio-field-pair">
              <label>Direction<input name={"direction-"+clip.id} maxLength={80} placeholder="Optional"/></label>
              <label>Loop mode<select name={"loop-"+clip.id} defaultValue="repeat">
                <option value="repeat">Repeat</option><option value="once">Once</option><option value="ping-pong">Ping-pong</option>
              </select></label>
            </div>
            <details>
              <summary>Frame metadata</summary>
              <label>Frame metadata (JSON)<textarea name={"metadata-"+clip.id} rows={4} spellCheck={false}
                placeholder={'[{"frame":0,"durationTicks":2}]'}/></label>
            </details>
          </>}
        </div>;
      })}
    </fieldset>
    <div className="studio-field-pair">
      <label>Pixel scale<select name="scale" defaultValue="1">
        {[1,2,3,4].map(value=><option key={value} value={value}>{value}×</option>)}
      </select></label>
      <label>Maximum texture size<input type="number" name="maximum" min={16} max={8192} defaultValue={2048} required/></label>
    </div>
    <div className="studio-field-pair">
      <label>Pivot X (px)<input type="number" name="pivotX" min={-8192} max={8192} step="any" defaultValue={artboard.width/2} required/></label>
      <label>Pivot Y (px)<input type="number" name="pivotY" min={-8192} max={8192} step="any" defaultValue={artboard.height} required/></label>
    </div>
    {layout==="packed" && <>
      <div className="studio-field-pair">
        <label>Padding (px)<input type="number" name="padding" min={0} max={16} defaultValue={2} required/></label>
        <label>Edge extrusion (px)<input type="number" name="extrusion" min={0} max={8} defaultValue={1} required/></label>
      </div>
      <label className="studio-check"><input type="checkbox" name="trim" defaultChecked/>Trim transparent edges</label>
      <label className="studio-check"><input type="checkbox" name="rotate"/>Allow 90° rotation</label>
    </>}
    <label>Texture filtering<select name="filter"><option value="nearest">Nearest</option><option value="linear">Linear</option></select></label>
    <div className="studio-field-pair">
      <label>Color space<select name="color"><option value="srgb">sRGB</option><option value="linear">Linear</option></select></label>
      <label>Alpha<select name="alpha"><option value="straight">Straight</option><option value="premultiplied">Premultiplied</option></select></label>
    </div>
    {pending && <p role="status">Reading saved frames…</p>}
    {plan && <section className="studio-bundle-plan" aria-label="Sprite bundle preflight">
      <p>{plan.clips.length} clips · {plan.files.length} PNG files · {(plan.textureBytes/1048576).toFixed(2)} MiB of texture memory</p>
      <ul>{plan.files.map(file=><li key={file.file}>{file.file} · {file.width} × {file.height}</li>)}</ul>
    </section>}
    {message && <p className="studio-key-error" role="status">{message}</p>}
    <a href="/sprite-player" target="_blank" rel="noreferrer">Open sprite reference player</a>
    <div className="studio-field-pair studio-bundle-actions">
      <button type="submit" value="check" disabled={pending || unsaved || !selected.length}>Check export</button>
      <button type="submit" className="studio-save" value="download" disabled={pending || unsaved || !selected.length}>Download sprite bundle</button>
    </div>
  </form>;
}
