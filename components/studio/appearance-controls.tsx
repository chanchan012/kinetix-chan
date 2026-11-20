"use client";

import { useState } from "react";
import { defaultStroke,resolvePaint,type Appearance,type Paint,type PaintValue,type Swatch } from "@/lib/rig/appearance";
import type { VectorPart } from "@/lib/rig/model";
import type { RigCommand } from "@/lib/rig/commands";
import { Dialog } from "../dialog";

type Edit = (label:string,...commands:RigCommand[])=>boolean;
type Linear = Extract<PaintValue,{kind:"linear"}>;

function NumberField({label,value,min,max,update}:{
  label:string;value:number;min?:number;max?:number;update:(value:number)=>void;
}) {
  return <label>{label}<input key={value} type="number" step="any" min={min} max={max} defaultValue={value}
    onKeyDown={event=>{ if (event.key==="Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
    onBlur={event=>{
      const field=event.currentTarget;
      const next=field.valueAsNumber;
      if (!Number.isFinite(next) || !field.checkValidity()) field.value=String(value);
      else if (next!==value) update(next);
    }}/></label>;
}

function makeGradient(color:string,part?:VectorPart):Linear {
  const points = part?.knots.map(knot=>knot.point) ?? [{x:0,y:0},{x:100,y:0}];
  const left = Math.min(...points.map(point=>point.x));
  const right = Math.max(...points.map(point=>point.x));
  const y = points[0].y;
  return {kind:"linear",from:{x:left,y},to:{x:Math.max(left+1,right),y},stops:[
    {offset:0,color},{offset:1,color:color.toLowerCase()==="#ffffff" ? "#000000" : "#ffffff"},
  ]};
}

function PaintFields({label,paint,swatches,update,part,nullable=false}:{
  label:string;paint:Paint|null;swatches:readonly Swatch[];update:(paint:Paint|null)=>void;part?:VectorPart;nullable?:boolean;
}) {
  const resolved = paint && resolvePaint(paint,swatches);
  const color = resolved?.kind==="linear" ? resolved.stops[0].color : resolved?.color ?? "#b54b2b";
  return <div className="studio-paint-fields">
    <label>{label} type<select value={paint?.kind ?? "none"} onChange={event=>{
      const mode=event.target.value;
      if (mode==="none") update(null);
      else if (mode==="solid") update({kind:"solid",color});
      else if (mode==="linear") update(makeGradient(color,part));
      else if (swatches[0]) update({kind:"swatch",id:swatches[0].id});
    }}>
      {nullable && <option value="none">None</option>}
      <option value="solid">Solid</option><option value="linear">Linear gradient</option>
      {swatches.length>0 && <option value="swatch">Linked swatch</option>}
    </select></label>
    {paint?.kind==="solid" && <label>{label} color<input type="color" value={paint.color}
      onChange={event=>update({kind:"solid",color:event.target.value})}/></label>}
    {paint?.kind==="swatch" && <label>{label} swatch<select value={paint.id}
      onChange={event=>update({kind:"swatch",id:event.target.value})}>
      {swatches.map(swatch=><option key={swatch.id} value={swatch.id}>{swatch.name}</option>)}
    </select></label>}
    {paint?.kind==="linear" && <GradientFields label={label} gradient={paint} update={update}/>}
  </div>;
}

function GradientFields({label,gradient,update}: {label:string;gradient:Linear;update:(gradient:Linear)=>void}) {
  return <>
    <div className="studio-field-pair">
      {(["from","to"] as const).flatMap((end,i)=>(["x","y"] as const).map(axis=>
        <NumberField key={end+axis} label={label+" "+(i?"end ":"start ")+axis.toUpperCase()} value={gradient[end][axis]}
          update={value=>{
            const point={...gradient[end],[axis]:value};
            const other=gradient[end==="from"?"to":"from"];
            if (Math.hypot(point.x-other.x,point.y-other.y)>=0.001) update({...gradient,[end]:point});
          }}/>))}
    </div>
    {gradient.stops.map((stop,i)=><div className="studio-gradient-stop" key={i}>
      <label>{label} stop {i+1}<input type="color" value={stop.color} onChange={event=>
        update({...gradient,stops:gradient.stops.map((item,index)=>i===index?{...item,color:event.target.value}:item)})}/></label>
      <NumberField label="Stop %" min={0} max={100} value={Math.round(stop.offset*10000)/100} update={value=>
        update({...gradient,stops:gradient.stops.map((item,index)=>i===index?{...item,offset:value/100}:item).sort((a,b)=>a.offset-b.offset)})}/>
      <button disabled={gradient.stops.length<=2} aria-label={"Remove "+label.toLowerCase()+" stop "+(i+1)}
        onClick={()=>update({...gradient,stops:gradient.stops.filter((_,index)=>i!==index)})}>×</button>
    </div>)}
    <button disabled={gradient.stops.length>=16} onClick={()=>{
      const pairs = gradient.stops.slice(1).map((stop,i)=>({left:gradient.stops[i],right:stop}));
      const {left,right}=pairs.reduce((best,pair)=>pair.right.offset-pair.left.offset>best.right.offset-best.left.offset?pair:best);
      update({...gradient,stops:[...gradient.stops,{color:left.color,offset:(left.offset+right.offset)/2}].sort((a,b)=>a.offset-b.offset)});
    }}>Add {label.toLowerCase()} stop</button>
  </>;
}

export function AppearanceControls({part,swatches,edit}: {part:VectorPart;swatches:readonly Swatch[];edit:Edit}) {
  const [showPalette,setShowPalette] = useState(false);
  const appearance = part.appearance ?? {};
  const fill = appearance.fill === undefined ? {kind:"solid" as const,color:part.fill} : appearance.fill;
  const stroke = appearance.stroke === undefined && !part.closed ? defaultStroke(part.fill) : appearance.stroke;
  const change = (values:Partial<Appearance>) => edit("Edit appearance",{type:"part.update",id:part.id,
    changes:{appearance:{...appearance,...values}}});
  return <details className="studio-appearance">
    <summary>Appearance</summary>
    <div className="studio-paint-fields">
      <NumberField label="Opacity (%)" min={0} max={100} value={(appearance.opacity ?? 1)*100} update={value=>change({opacity:value/100})}/>
      {part.closed && !part.facets && <PaintFields label="Fill" paint={fill} swatches={swatches} part={part} nullable
        update={paint=>change({fill:paint})}/>}
      <label className="studio-check"><input type="checkbox" checked={Boolean(stroke)}
        onChange={event=>change({stroke:event.target.checked ? defaultStroke(part.fill) : null})}/>Stroke</label>
      {stroke && <>
        <PaintFields label="Stroke" paint={stroke.paint} swatches={swatches} part={part}
          update={paint=>{ if (paint) change({stroke:{...stroke,paint}}); }}/>
        <NumberField label="Stroke width (px)" min={0.01} max={512} value={stroke.width}
          update={width=>change({stroke:{...stroke,width}})}/>
        <div className="studio-field-pair">
          <label>Line cap<select value={stroke.cap} onChange={event=>change({stroke:{...stroke,cap:event.target.value as typeof stroke.cap}})}>
            <option value="butt">Flat</option><option value="round">Round</option><option value="square">Square</option>
          </select></label>
          <label>Line join<select value={stroke.join} onChange={event=>change({stroke:{...stroke,join:event.target.value as typeof stroke.join}})}>
            <option value="miter">Miter</option><option value="round">Round</option><option value="bevel">Bevel</option>
          </select></label>
        </div>
        {stroke.join==="miter" && <NumberField label="Miter limit" min={1} max={64} value={stroke.miter}
          update={miter=>change({stroke:{...stroke,miter}})}/>}
        <label>Dash lengths (px)<input key={stroke.dash.join(",")} defaultValue={stroke.dash.join(", ")} placeholder="Continuous"
          onKeyDown={event=>{ if (event.key==="Enter") event.currentTarget.blur(); }}
          onBlur={event=>{
            const field=event.currentTarget;
            const dash=field.value.trim() ? field.value.trim().split(/[\s,]+/).map(Number) : [];
            if (dash.length>16 || dash.some(size=>!(size>0 && size<=2048))) field.value=stroke.dash.join(", ");
            else if (dash.join(",")!==stroke.dash.join(",")) change({stroke:{...stroke,dash}});
          }}/></label>
        {stroke.dash.length>0 && <NumberField label="Dash offset (px)" min={-2048} max={2048} value={stroke.offset ?? 0}
          update={offset=>change({stroke:{...stroke,offset}})}/>}
      </>}
      <button onClick={()=>setShowPalette(true)}>Manage swatches</button>
    </div>
    {showPalette && <SwatchDialog swatches={swatches} defaultPaint={fill ? resolvePaint(fill,swatches) : {kind:"solid",color:part.fill}}
      edit={edit} close={()=>setShowPalette(false)}/>}
  </details>;
}

function SwatchDialog({swatches,defaultPaint,edit,close}: {
  swatches:readonly Swatch[];defaultPaint:PaintValue;edit:Edit;close:()=>void;
}) {
  const [selected,setSelected] = useState(swatches[0]?.id ?? "");
  const active = swatches.find(swatch=>swatch.id===selected);
  const save = (swatch:Swatch) => edit("Edit swatch",{type:"swatch.set",swatch});
  return <Dialog title="Swatches" className="studio-easing studio-export" onClose={close}>
    <div className="studio-properties">
      <button disabled={swatches.length>=128} onClick={()=>{
        const id=crypto.randomUUID();
        if (save({id,name:"Swatch "+(swatches.length+1),paint:defaultPaint})) setSelected(id);
      }}>Save current paint as swatch</button>
      {swatches.length>0 && <label>Swatch<select value={selected} onChange={event=>setSelected(event.target.value)}>
        <option value="">Choose swatch</option>
        {swatches.map(swatch=><option key={swatch.id} value={swatch.id}>{swatch.name}</option>)}
      </select></label>}
      {active && <>
        <label>Swatch name<input key={active.id+active.name} defaultValue={active.name} maxLength={120}
          onKeyDown={event=>{ if (event.key==="Enter") event.currentTarget.blur(); }}
          onBlur={event=>{
            const name=event.currentTarget.value.trim();
            if (!name) event.currentTarget.value=active.name;
            else if (name!==active.name) save({...active,name});
          }}/></label>
        <PaintFields label="Swatch" paint={active.paint} swatches={[]} update={paint=>{
          if (paint && paint.kind!=="swatch") save({...active,paint});
        }}/>
        <button onClick={()=>{
          if (edit("Remove swatch",{type:"swatch.remove",id:active.id})) setSelected("");
        }}>Remove swatch</button>
      </>}
    </div>
  </Dialog>;
}
