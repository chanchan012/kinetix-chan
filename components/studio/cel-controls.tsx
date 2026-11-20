"use client";

import { useState } from "react";
import { exposureAt, type Drawing, type DrawingSample } from "@/lib/rig/drawings";
import type { CelStroke, PixelOperation } from "@/lib/rig/cel-tools";
import type { RigCommand } from "@/lib/rig/commands";

export type PixelRegion = Extract<PixelOperation,{kind:"transform"}>["region"];
export type CelSettings = {
  tool:CelStroke["tool"]|"fill"|"sample"|"region";
  color:string;index:number;size:number;opacity:number;stabilization:number;symmetry:CelStroke["symmetry"];
  tolerance:number;grid:boolean;region:PixelRegion|null;
  previous:string;next:string;onionOpacity:number;
};
export const defaultCelSettings:CelSettings = {
  tool:"pencil",color:"#ff9500",index:0,size:1,opacity:1,stabilization:0,symmetry:"none",tolerance:0,
  grid:false,region:null,previous:"#ff5b64",next:"#1ba5dc",onionOpacity:0.22,
};
export function celInk(drawing:Drawing,settings:CelSettings) {
  return 256*(drawing.storage.mode==="indexed" ? Math.min(settings.index,drawing.storage.colors.length-1) :
    Number.parseInt(settings.color.slice(1),16))+255;
}

export function CelControls({drawing,sample,settings,update,editable,edit,remove}:{
  drawing:Drawing;sample:DrawingSample;settings:CelSettings;update:(changes:Partial<CelSettings>)=>void;
  editable:boolean;edit:(label:string,...commands:RigCommand[])=>boolean;remove:()=>void;
}) {
  const id=drawing.id;
  const celId=exposureAt(drawing,sample);
  const frame=sample.frame;
  const key=drawing.tracks.find(track=>track.clipId===sample.clipId)?.keys.find(item=>item.frame===frame);
  const [layout,setLayout]=useState({offsetX:0,offsetY:0,rotation:"0" as "0"|"90"|"180"|"270",flipX:false,flipY:false,scale:1});
  const [rampEnd,setRampEnd]=useState("#fff2a0");
  const reference=(nextId:string|null):RigCommand => sample.clipId ?
    {type:"exposure.set",drawingId:id,clipId:sample.clipId,key:{frame,celId:nextId}} :
    {type:"drawing.rest",id,celId:nextId};
  function addCel(duplicate:boolean) {
    const newId=crypto.randomUUID();
    edit(duplicate?"Make independent cel":"Create cel",
      {type:"cel.create",drawingId:id,id:newId,sourceId:duplicate?(celId ?? undefined):undefined},reference(newId));
  }
  function palette(colors:string[]) {
    return edit("Edit indexed palette",{type:"drawing.palette",id,colors});
  }
  const colors = drawing.storage.mode==="indexed" ? drawing.storage.colors : null;
  const active = Math.min(settings.index,(colors?.length ?? 1)-1);
  return <div className="studio-properties" aria-label="Drawing tools">
    <p className="studio-empty">{editable ? (sample.clipId ? "Frame "+(frame+1) : "Base drawing") : "Pause playback and show and unlock the drawing layer to edit it."}</p>
    <fieldset className="studio-cel-fields" disabled={!editable}>
      <button onClick={()=>addCel(false)}>New cel</button>
      <button disabled={!celId} onClick={()=>addCel(true)}>Make independent</button>
      <label>Linked cel<select value={celId ?? ""} onChange={event=>edit("Link cel",reference(event.target.value||null))}>
        <option value="">Blank</option>
        {drawing.cels.map((cel,index)=><option key={cel.id} value={cel.id}>Cel {index+1}</option>)}
      </select></label>
      {sample.clipId && <>
        <button disabled={!celId || key?.celId===celId} onClick={()=>edit("Link held cel",reference(celId))}>Link held cel</button>
        <button disabled={key?.celId===null} onClick={()=>edit("Blank exposure",reference(null))}>Blank exposure</button>
        <button disabled={!key} onClick={()=>edit("Remove exposure",
          {type:"exposure.remove",drawingId:id,clipId:sample.clipId!,frame})}>Remove exposure</button>
      </>}
      <label>Pixel tool<select value={settings.tool} onChange={event=>update({tool:event.target.value as CelSettings["tool"]})}>
        <option value="pencil">Pencil</option><option value="brush">Pressure brush</option>
        <option value="eraser">Eraser</option><option value="fill">Flood fill</option>
        <option value="sample">Eyedropper</option><option value="region">Pixel selection</option>
      </select></label>
      {colors ? <>
        <label>Palette color<select value={active} onChange={event=>update({index:Number(event.target.value)})}>
          {colors.map((color,index)=><option key={index} value={index}>Color {index+1} · {color}</option>)}
        </select></label>
        <label>Edit palette color<input type="color" value={colors[active]}
          onChange={event=>palette(colors.map((color,index)=>index===active ? event.target.value : color))}/></label>
        <button disabled={colors.length>=256} onClick={()=>{
          if (palette([...colors,"#ffffff"])) update({index:colors.length});
        }}>Add palette color</button>
        <details>
          <summary>Palette ramp</summary>
          <label>Ramp end color<input type="color" value={rampEnd} onChange={event=>setRampEnd(event.target.value)}/></label>
          <button disabled={colors.length>252} onClick={()=>{
            const rgb=(color:string)=>[1,3,5].map(i=>Number.parseInt(color.slice(i,i+2),16));
            const start=rgb(colors[active]);
            const end=rgb(rampEnd);
            const ramp=[1,2,3,4].map(step=>"#"+start.map((value,i)=>
              Math.round(value+(end[i]-value)*step/4).toString(16).padStart(2,"0")).join(""));
            palette([...colors,...ramp]);
          }}>Add four ramp colors</button>
        </details>
      </> : <label>Ink color<input type="color" value={settings.color}
        onChange={event=>update({color:event.target.value})}/></label>}
      {settings.tool==="fill" ? <label>Fill tolerance<input type="range" min={0} max={255} value={settings.tolerance}
        onChange={event=>update({tolerance:event.target.valueAsNumber})}/></label> : settings.tool==="region" ? <>
        <p>{settings.region ? settings.region.width+" × "+settings.region.height+" selected" : "Drag a rectangle on the canvas to select pixels."}</p>
        <div className="studio-field-pair">
          <label>Move X<input type="number" min={-4096} max={4096} step={1} value={layout.offsetX}
            onChange={event=>setLayout({...layout,offsetX:Number(event.target.value)})}/></label>
          <label>Move Y<input type="number" min={-4096} max={4096} step={1} value={layout.offsetY}
            onChange={event=>setLayout({...layout,offsetY:Number(event.target.value)})}/></label>
        </div>
        <label>Rotation<select value={layout.rotation}
          onChange={event=>setLayout({...layout,rotation:event.target.value as typeof layout.rotation})}>
          {["0","90","180","270"].map(angle=><option key={angle}>{angle}</option>)}
        </select></label>
        <label>Selection scale<select value={layout.scale} onChange={event=>setLayout({...layout,scale:Number(event.target.value)})}>
          {[1,2,3,4].map(scale=><option key={scale} value={scale}>{scale}×</option>)}
        </select></label>
        <label className="studio-check"><input type="checkbox" checked={layout.flipX}
          onChange={event=>setLayout({...layout,flipX:event.target.checked})}/>Flip horizontally</label>
        <label className="studio-check"><input type="checkbox" checked={layout.flipY}
          onChange={event=>setLayout({...layout,flipY:event.target.checked})}/>Flip vertically</label>
        <button disabled={!settings.region || !celId} onClick={()=>{
          if (settings.region && celId && edit("Transform pixels",{type:"cel.edit",drawingId:id,id:celId,
            operation:{kind:"transform",region:settings.region,...layout}})) update({region:null});
        }}>Transform selection</button>
      </> : settings.tool!=="sample" && <>
        <label>Brush size<input type="range" min={1} max={128} value={settings.size}
          onChange={event=>update({size:event.target.valueAsNumber})}/></label>
        <label>Brush opacity<input type="range" min={0} max={1} step={0.01} value={settings.opacity}
          onChange={event=>update({opacity:event.target.valueAsNumber})}/></label>
        <label>Stabilization<input type="range" min={0} max={0.9} step={0.05} value={settings.stabilization}
          onChange={event=>update({stabilization:event.target.valueAsNumber})}/></label>
        <label>Symmetry<select value={settings.symmetry} onChange={event=>update({symmetry:event.target.value as CelSettings["symmetry"]})}>
          <option value="none">None</option><option value="horizontal">Horizontal</option>
          <option value="vertical">Vertical</option><option value="both">Both</option>
        </select></label>
      </>}
      <button className="studio-danger" onClick={remove}>Delete drawing layer</button>
    </fieldset>
    <label className="studio-check"><input type="checkbox" checked={settings.grid}
      onChange={event=>update({grid:event.target.checked})}/>Pixel grid</label>
    <details>
      <summary>Onion colors</summary>
      <label>Previous cel<input type="color" value={settings.previous} onChange={event=>update({previous:event.target.value})}/></label>
      <label>Next cel<input type="color" value={settings.next} onChange={event=>update({next:event.target.value})}/></label>
      <label>Onion opacity<input type="range" min={0} max={0.6} step={0.01} value={settings.onionOpacity}
        onChange={event=>update({onionOpacity:event.target.valueAsNumber})}/></label>
    </details>
  </div>;
}
