"use client";

import { useState,type CSSProperties } from "react";
import { CaretDown, CaretUp, Eye, EyeSlash, FolderSimple, LockSimple, LockSimpleOpen } from "@phosphor-icons/react";
import type { RigCommand } from "@/lib/rig/commands";
import { inLayerSubtree,layerTreeFor,orderedLayers } from "@/lib/rig/layer-tree";
import type { KinetixRigState } from "@/lib/rig/model";

export function LayerList({rig,selectedParts,boneSelected,selectPart,isolate,setIsolate,edit}: {
  rig:KinetixRigState;
  selectedParts:string[];
  boneSelected:boolean;
  selectPart:(id:string|null)=>void;
  isolate:string|null;
  setIsolate:(id:string|null)=>void;
  edit:(label:string,command:RigCommand)=>boolean;
}) {
  const [selectedGroup,setSelectedGroup] = useState<string|null>(null);
  const [search,setSearch] = useState("");
  const tree = layerTreeFor(rig);
  const rows = orderedLayers(tree);
  const parts = new Map(rig.parts.map(part=>[part.id,part]));
  const group = !boneSelected && selectedParts.length===0 && tree.nodes.find(node=>node.id===selectedGroup && node.kind==="group");
  const active = group || tree.nodes.findLast(node=>node.kind==="part" && selectedParts.includes(node.partId));
  const selectedNodes = rows.flatMap(row=>
    row.node.kind==="part" && selectedParts.includes(row.node.partId) ? [row.node.id] : []);
  if (!rows.length) return null;
  const parents = new Set(tree.nodes.filter(node=>selectedNodes.includes(node.id)).map(node=>node.parentId));
  const siblings = active ? tree.nodes.filter(node=>node.parentId===active.parentId) : [];
  const index = active ? siblings.findIndex(node=>node.id===active.id) : -1;
  const children = active ? inLayerSubtree(tree,active.id) : new Set<string>();
  const query = search.trim().toLowerCase();
  return <section className="studio-layer-list" aria-label="Artwork layers">
    <h3>Layers</h3>
    <label className="studio-layer-search"><span className="sr-only">Search layers</span>
      <input type="search" placeholder="Find layer" value={search} onChange={event=>setSearch(event.target.value)}/>
    </label>
    <ul>{rows.map(({node,depth,hidden,locked})=>{
      const part = node.kind==="part" ? parts.get(node.partId) : undefined;
      const name = node.kind==="group" ? node.name : part?.name ?? "Path";
      const nameId = "layer-name-"+node.id;
      if (query && !name.toLowerCase().includes(query)) return null;
      const selected = node.kind==="group" ? active?.id===node.id : selectedParts.includes(node.partId);
      return <li key={node.id} className="studio-layer-row" data-hidden={hidden} data-locked={locked}>
        <button style={{"--depth":Math.min(depth,8)} as CSSProperties} aria-pressed={selected}
          onClick={()=>{
            if (node.kind==="group") {
              setSelectedGroup(node.id);
              selectPart(null);
            } else {
              setSelectedGroup(null);
              selectPart(node.partId);
            }
          }}>
          {node.kind==="group" ? <FolderSimple size={14}/> :
            <span className="studio-swatch" style={{backgroundColor:part?.facets?.faces[0].fill ?? part?.fill}}/>}
          <span id={nameId}>{name}</span>
        </button>
        <button type="button" aria-label={node.hidden ? "Show layer" : "Hide layer"} aria-describedby={nameId}
          onClick={()=>edit(node.hidden ? "Show layer" : "Hide layer",{type:"layer.flags",id:node.id,hidden:!node.hidden})}>
          {node.hidden ? <EyeSlash size={14}/> : <Eye size={14}/>}
        </button>
        <button type="button" aria-label={node.locked ? "Unlock layer" : "Lock layer"} aria-describedby={nameId}
          onClick={()=>edit(node.locked ? "Unlock layer" : "Lock layer",{type:"layer.flags",id:node.id,locked:!node.locked})}>
          {node.locked ? <LockSimple size={14}/> : <LockSimpleOpen size={14}/>}
        </button>
      </li>;
    })}</ul>
    <div className="studio-layer-actions">
      <button disabled={!selectedNodes.length || parents.size!==1} onClick={()=>{
        const id = crypto.randomUUID();
        if (edit("Group layers",{type:"layer.group",id,name:"Group",members:selectedNodes})) {
          setSelectedGroup(id);
          selectPart(null);
        }
      }}>Group selected</button>
      {isolate && <button onClick={()=>setIsolate(null)}>Exit isolation</button>}
      {active && <>
        {active.kind==="group" && <label>Group name<input key={active.id+":"+active.name} defaultValue={active.name} maxLength={120}
          onKeyDown={event=>{ if (event.key==="Enter") event.currentTarget.blur(); }}
          onBlur={event=>{
            const name = event.currentTarget.value.trim();
            if (!name || (name!==active.name && !edit("Rename group",{type:"layer.rename",id:active.id,name}))) {
              event.currentTarget.value=active.name;
            }
          }}/></label>}
        <label>Parent group<select value={active.parentId ?? ""} onChange={event=>
          edit("Move layer",{type:"layer.move",id:active.id,parentId:event.target.value||null,index:256})}>
          <option value="">Root</option>
          {rows.filter(row=>row.node.kind==="group" && !children.has(row.node.id)).map(({node})=>
            node.kind==="group" && <option key={node.id} value={node.id}>{node.name}</option>)}
        </select></label>
        <label>Clipping mask<select value={active.maskPartId ?? ""} onChange={event=>
          edit("Set clipping mask",{type:"layer.mask",id:active.id,partId:event.target.value||null})}>
          <option value="">None</option>
          {rig.parts.filter(part=>part.closed && (active.kind!=="part" || part.id!==active.partId)).map(part=>
            <option key={part.id} value={part.id}>{part.name}</option>)}
        </select></label>
        <div className="studio-field-pair">
          <button aria-label="Raise layer" disabled={index===siblings.length-1} onClick={()=>
            edit("Raise layer",{type:"layer.move",id:active.id,parentId:active.parentId,index:index+1})}><CaretUp size={14}/></button>
          <button aria-label="Lower layer" disabled={index<=0} onClick={()=>
            edit("Lower layer",{type:"layer.move",id:active.id,parentId:active.parentId,index:index-1})}><CaretDown size={14}/></button>
        </div>
        <button onClick={()=>setIsolate(active.id)}>Isolate layer</button>
        <button onClick={()=>edit("Duplicate layer",{type:"layer.duplicate",id:active.id,prefix:crypto.randomUUID().slice(0,16)})}>
          Duplicate layer
        </button>
        {active.kind==="group" && <button onClick={()=>edit("Ungroup layers",{type:"layer.ungroup",id:active.id})}>Ungroup</button>}
      </>}
    </div>
  </section>;
}
