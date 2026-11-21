"use client";

import { useState,type FormEvent } from "react";
import { Dialog } from "../dialog";
import { archiveBase64 } from "@/lib/import/archive-base64";
import { fitImagePlacement,imageDescription,imageFileBytes,type ImageAsset,type ImagePlacement } from "@/lib/rig/images";
import { artboardFor,type KinetixRigState } from "@/lib/rig/model";
import type { RigCommand } from "@/lib/rig/commands";
import type { ImageLayer } from "@/lib/rig/layer-tree";

type Edit=(label:string,...commands:RigCommand[])=>boolean;

export function ImageAssetsDialog({rig,rigId,initialAsset,edit,place,close}:{
  rig:KinetixRigState;rigId:string;initialAsset?:string;edit:Edit;place:(id:string)=>void;close:()=>void;
}) {
  const [search,setSearch]=useState("");
  const [selected,setSelected]=useState(initialAsset ?? "");
  const [replace,setReplace]=useState(initialAsset ?? "");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const assets=rig.images?.assets ?? [];
  const sources=new Map(rig.images?.sources.map(source=>[source.sha256,source.base64]));
  const target=assets.find(asset=>asset.id===replace);
  const active=assets.find(asset=>asset.id===selected);
  const counts=new Map<string,number>();
  for (const node of rig.layers?.nodes ?? []) if (node.kind==="image") {
    counts.set(node.placement.assetId,(counts.get(node.placement.assetId) ?? 0)+1);
  }
  const query=search.trim().toLowerCase();
  const visible=assets.filter(asset=>`${asset.folder} ${asset.name}`.toLowerCase().includes(query))
    .toSorted((a,b)=>a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));

  async function upload(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form=event.currentTarget;
    const values=new FormData(form);
    const file=values.get("image");
    setError("");setMessage("");
    if (!(file instanceof File) || !file.size) {setError("Choose a PNG or WebP image.");return;}
    if (file.size>imageFileBytes) {setError("Choose an image of 1 MiB or less.");return;}
    setBusy(true);
    try {
      const base64=archiveBase64(new Uint8Array(await file.arrayBuffer()));
      const response=await fetch(`/api/rigs/${rigId}/image-assets/inspect`,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({base64})});
      const data=await response.json().catch(()=>null);
      if (!response.ok) throw new Error(data?.message ?? "Could not inspect the image.");
      const description=imageDescription.parse(data);
      const asset={...description,id:target?.id ?? crypto.randomUUID(),
        name:target?.name ?? (String(values.get("name") ?? "").trim() || file.name.replace(/\.(png|webp)$/i,"").trim().slice(0,120) || "Image"),
        folder:target?.folder ?? String(values.get("folder") ?? "").trim()};
      if (!edit(target ? "Relink image asset" : "Import image asset",{type:"image.asset.put",asset,base64})) {
        throw new Error("The image could not be added. Check the project image capacity.");
      }
      setSelected(asset.id);setSearch("");setReplace("");form.reset();
      setMessage(target ? "Image replaced in every placement." : "Image added to this project.");
    } catch (failure) {setError(failure instanceof Error ? failure.message : "Could not import the image.");}
    finally {setBusy(false);}
  }

  function add(asset:ImageAsset,mode:ImagePlacement["mode"]) {
    const id=crypto.randomUUID();
    if (edit("Place image",{type:"image.place",id,placement:fitImagePlacement(asset,artboardFor(rig),mode)})) place(id);
  }

  function label(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || busy) return;
    const values=new FormData(event.currentTarget);
    const name=String(values.get("name")).trim();
    const folder=String(values.get("folder")).trim();
    if (name && edit("Organize image asset",{type:"image.asset.label",id:active.id,name,folder})) {
      setSearch("");setMessage("Image details saved.");
    }
  }

  return <Dialog title="Image assets" className="studio-easing studio-export studio-image-assets" onClose={()=>{if (!busy) close();}}>
    <label className="studio-export-format">Search image assets<input type="search" value={search} onChange={event=>setSearch(event.target.value)}/></label>
    {visible.length>0 && <ul className="studio-image-catalog" aria-label="Project images">
      {visible.map(asset=>{
        const source=sources.get(asset.sha256);
        return <li key={asset.id}><button type="button" aria-pressed={selected===asset.id} disabled={busy} onClick={()=>setSelected(asset.id)}>
          {source && <img alt="" src={`data:${asset.mimeType};base64,${source}`}/>}
          <span><strong>{asset.name}</strong><small>{asset.folder || "Project root"} · {counts.get(asset.id) ?? 0} placements{!source && " · Missing"}</small></span>
        </button></li>;
      })}
    </ul>}
    {active && <section aria-label="Selected image asset" className="studio-image-selection">
      <h3>{active.name}</h3>
      <p>{active.width} × {active.height} px · {active.mimeType==="image/png" ? "PNG" : "WebP"}</p>
      <div className="studio-field-pair">
        <button disabled={busy || !sources.has(active.sha256)} onClick={()=>add(active,"reference")}>Place reference</button>
        <button disabled={busy || !sources.has(active.sha256)} onClick={()=>add(active,"artwork")}>Place artwork</button>
      </div>
      <button disabled={busy} onClick={()=>{setReplace(active.id);setMessage("");setError("");}}>{sources.has(active.sha256) ? "Replace image" : "Relink image"}</button>
      <details><summary>Image details</summary>
        <form onSubmit={label} key={active.id}>
          <label>Asset name<input name="name" defaultValue={active.name} maxLength={120} required/></label>
          <label>Folder<input name="folder" defaultValue={active.folder} maxLength={120}/></label>
          <button disabled={busy}>Save image details</button>
          {!counts.get(active.id) && <button type="button" disabled={busy} onClick={()=>{
            if (edit("Remove image asset",{type:"image.asset.remove",id:active.id})) {setSelected("");setReplace("");}
          }}>Remove unused image</button>}
        </form>
      </details>
    </section>}
    <form onSubmit={upload} aria-label={target ? "Replace image file" : "Import image file"}>
      {target && <p>Replace {target.name} in {counts.get(target.id) ?? 0} placements.</p>}
      <label>{target ? "Replacement PNG or WebP" : "PNG or WebP file"}<input type="file" name="image" accept=".png,.webp,image/png,image/webp" required disabled={busy}/></label>
      {!target && <div className="studio-field-pair">
        <label>New image name<input name="name" maxLength={120}/></label>
        <label>New image folder<input name="folder" maxLength={120}/></label>
      </div>}
      <button type="submit" className="studio-save" disabled={busy}>{target ? "Apply replacement" : "Import image"}</button>
      {target && <button type="button" disabled={busy} onClick={()=>setReplace("")}>Cancel replacement</button>}
    </form>
    {busy && <p role="status">Checking image bytes…</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </Dialog>;
}

export function ImagePlacementControls({node,rig,locked,edit,manage,clear}:{
  node:ImageLayer;rig:KinetixRigState;locked:boolean;edit:Edit;manage:(id:string)=>void;clear:()=>void;
}) {
  const {id,placement}=node;
  const asset=rig.images?.assets.find(asset=>asset.id===placement.assetId);
  const available=rig.images?.sources.some(source=>source.sha256===asset?.sha256);
  function update(changes:Partial<ImagePlacement>) {return edit("Edit image placement",{type:"image.update",id,changes});}
  function field(label:string,property:"x"|"y"|"width"|"height"|"opacity"|"rotation",min:number,max:number,factor=1) {
    const value=placement[property]*factor;
    return <label>{label}<input type="number" key={`${property}-${value}`} defaultValue={Math.round(value*100)/100} min={min} max={max} step="any"
      onKeyDown={event=>{if (event.key==="Enter") event.currentTarget.blur();}}
      onBlur={event=>{
        const result=event.currentTarget.valueAsNumber;
        if (Number.isFinite(result) && result>=min && result<=max && Math.abs(result-value)>0.005) {
          if (update({[property]:result/factor})) return;
        }
        event.currentTarget.value=String(Math.round(value*100)/100);
      }}/></label>;
  }
  return <section className="studio-properties studio-image-properties" aria-label="Image placement">
    <h3>{placement.name}</h3>
    <p>{asset?.name}{!available && " · Missing image"}</p>
    <button onClick={()=>manage(placement.assetId)}>{available ? "Manage image asset" : "Relink missing image"}</button>
    <fieldset disabled={locked}>
      <label>Image layer name<input key={placement.name} defaultValue={placement.name} maxLength={120} onBlur={event=>{
        const name=event.currentTarget.value.trim();
        if (!name || (name!==placement.name && !update({name}))) event.currentTarget.value=placement.name;
      }} onKeyDown={event=>{if (event.key==="Enter") event.currentTarget.blur();}}/></label>
      <label>Image visibility<select value={placement.mode} onChange={event=>update({mode:event.target.value as ImagePlacement["mode"]})}>
        <option value="reference">Reference only</option><option value="artwork">Artwork and exports</option>
      </select></label>
      <label>Attach image to bone<select value={placement.boneId ?? ""} onChange={event=>update({boneId:event.target.value || null})}>
        <option value="">Artboard</option>{rig.bones.map(bone=><option key={bone.id} value={bone.id}>{bone.name}</option>)}
      </select></label>
      <div className="studio-field-pair">{field("Image X (px)","x",-1_000_000,1_000_000)}{field("Image Y (px)","y",-1_000_000,1_000_000)}</div>
      <div className="studio-field-pair">{field("Image width (px)","width",0.1,8192)}{field("Image height (px)","height",0.1,8192)}</div>
      <div className="studio-field-pair">{field("Image opacity (%)","opacity",0,100,100)}{field("Image rotation (°)","rotation",-1000*180/Math.PI,1000*180/Math.PI,180/Math.PI)}</div>
      <button onClick={()=>{if (edit("Remove image placement",{type:"image.remove",id})) clear();}}>Remove image placement</button>
    </fieldset>
    {locked && <p>Unlock the image layer to edit its placement.</p>}
  </section>;
}
