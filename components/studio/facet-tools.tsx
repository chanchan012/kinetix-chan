"use client";

import { useState } from "react";
import type { RigCommand } from "@/lib/rig/commands";
import type { FacetGraph,Point,VectorPart } from "@/lib/rig/model";
import { triangulateFacets } from "@/lib/rig/facet-geometry";

export type FacetMode = "face" | "edge" | "vertex" | "draw" | "sample";
export type FacetDraftPoint = {id:string;point:Point};
type Edit = (label:string,command:RigCommand)=>boolean;

export type FacetViewportTool = {
  partId:string;
  mode:FacetMode;
  faceId:string;
  a:string;
  b:string;
  draft:FacetDraftPoint[];
  triangulation:FacetGraph | null;
  pickFace:(id:string)=>void;
  pickEdge:(a:string,b:string)=>void;
  pickVertex:(id:string)=>void;
  sample:(fill:string)=>void;
  addVertex:(point:FacetDraftPoint)=>void;
  closeFace:()=>void;
};

type State = Pick<FacetViewportTool,"partId"|"mode"|"faceId"|"a"|"b"|"draft"|"triangulation"> & {sampled:string};

export function useFacetTool(part:VectorPart | undefined,edit:Edit) {
  const [saved,setSaved] = useState<State | null>(null);
  const graph = part?.facets;
  const initial:State = {
    partId:part?.id ?? "",mode:"face",faceId:graph?.faces[0]?.id ?? "",a:"",b:"",draft:[],
    triangulation:null,sampled:graph?.faces[0]?.fill ?? "#b54b2b",
  };
  const state = saved?.partId===part?.id && saved ? saved : initial;
  const update = (changes:Partial<State>) => setSaved(current=>({
    ...(current?.partId===part?.id && current ? current : initial),...changes,
  }));
  const closeFace = () => {
    if (!graph || !part || state.draft.length<3) return;
    const ids = new Set(graph.vertices.map(vertex=>vertex.id));
    const faceId = crypto.randomUUID();
    if (edit("Draw connected face",{
      type:"facet.add",id:part.id,faceId,fill:state.sampled,
      vertices:state.draft.map(vertex=>ids.has(vertex.id) ? {id:vertex.id} : vertex),
    })) update({draft:[],faceId,mode:"face"});
  };
  const viewport:FacetViewportTool = {
    ...state,
    pickFace:faceId=>update({faceId,triangulation:null}),
    pickEdge:(a,b)=>update({a,b,triangulation:null}),
    pickVertex:a=>update({a,triangulation:null}),
    sample:sampled=>update({mode:"face",sampled}),
    addVertex:point=>{
      if (state.draft[0]?.id===point.id && state.draft.length>=3) closeFace();
      else if (state.draft.length<256 && !state.draft.some(item=>item.id===point.id)) {
        update({draft:[...state.draft,point]});
      }
    },
    closeFace,
  };
  return {state,update,viewport};
}

export function FacetPanel({part,tool,active,activate,edit}: {
  part:VectorPart & {facets:FacetGraph};
  tool:ReturnType<typeof useFacetTool>;
  active:boolean;
  activate:()=>void;
  edit:Edit;
}) {
  const {state,update,viewport} = tool;
  const {facets} = part;
  const face = facets.faces.find(item=>item.id===state.faceId) ?? facets.faces[0];
  const [mirrorAxis,setMirrorAxis] = useState<"x"|"y">("x");
  const [mirrorLine,setMirrorLine] = useState("0");
  const [previewError,setPreviewError] = useState("");
  const edgeExists = facets.faces.some(item=>item.vertices.some((id,i)=>{
    const next = item.vertices[(i+1)%item.vertices.length];
    return (id===state.a && next===state.b) || (id===state.b && next===state.a);
  }));
  const a = facets.vertices.some(vertex=>vertex.id===state.a) ? state.a : "";
  const b = facets.vertices.some(vertex=>vertex.id===state.b) ? state.b : "";
  const primary = facets.vertices.find(vertex=>vertex.id===a);
  const validPair = a && b && a!==b;
  const choose = (mode:FacetMode) => {
    activate();
    update({mode,triangulation:null,...(mode!=="draw" && {draft:[]})});
  };
  const apply = (label:string,command:RigCommand) => {
    if (edit(label,command)) update({a:"",b:"",triangulation:null});
  };
  const preview = () => {
    activate();
    setPreviewError("");
    try {
      const next = triangulateFacets(facets,"preview",face.id);
      update({triangulation:next,mode:"face",draft:[]});
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Could not preview triangulation.");
    }
  };
  return <section className="studio-properties studio-facet-properties" aria-label="Facet tools">
    <div className="studio-field-pair">
      {(["face","edge","vertex"] as const).map(mode=><button key={mode} aria-pressed={active && state.mode===mode}
        onClick={()=>choose(mode)}>{mode[0].toUpperCase()+mode.slice(1)}</button>)}
    </div>
    <div className="studio-field-pair">
      <button aria-pressed={active && state.mode==="draw"} onClick={()=>choose("draw")}>Draw face</button>
      <button aria-pressed={active && state.mode==="sample"} onClick={()=>choose("sample")}>Eyedropper</button>
    </div>
    {active && state.mode==="draw" && <div className="studio-field-pair">
      <button disabled={state.draft.length<3} onClick={viewport.closeFace}>Close face</button>
      <button onClick={()=>choose("face")}>Cancel face</button>
    </div>}
    <label>Active face<select value={face.id} onChange={event=>viewport.pickFace(event.target.value)}>
      {facets.faces.map((item,index)=><option key={item.id} value={item.id}>Face {index+1}</option>)}
    </select></label>
    <div className="studio-field-pair">
      <label>Face color<input type="color" value={face.fill} onChange={event=>{
        if (edit("Paint face",{type:"facet.paint",id:part.id,faceId:face.id,fill:event.target.value})) {
          update({sampled:event.target.value});
        }
      }}/></label>
      <label>Drawing color<input type="color" value={state.sampled} onChange={event=>update({sampled:event.target.value})}/></label>
    </div>
    <button onClick={()=>edit("Apply sampled color",{type:"facet.paint",id:part.id,faceId:face.id,fill:state.sampled})}>
      Apply drawing color to face
    </button>
    <div className="studio-field-pair">
      {([["a",a],["b",b]] as const).map(([key,value],slot)=><label key={key}>Vertex {slot+1}<select value={value}
        onChange={event=>update({[key]:event.target.value})}>
        <option value="">Choose vertex</option>
        {facets.vertices.map((vertex,index)=><option key={vertex.id} value={vertex.id}>Vertex {index+1}</option>)}
      </select></label>)}
    </div>
    {primary && <div className="studio-field-pair">
      {(["x","y"] as const).map(axis=><label key={axis}>Vertex {axis.toUpperCase()} (px)
        <input key={primary.id+":"+primary.point[axis]} type="number" step="any" defaultValue={primary.point[axis]}
          onKeyDown={event=>{ if (event.key==="Enter") event.currentTarget.blur(); }}
          onBlur={event=>{
            const next = event.currentTarget.valueAsNumber;
            if (next===primary.point[axis]) return;
            if (!Number.isFinite(next) || !edit("Move facet vertex",{
              type:"facet.move",id:part.id,vertexId:primary.id,point:{...primary.point,[axis]:next},
            })) event.currentTarget.value=String(primary.point[axis]);
          }}/>
      </label>)}
    </div>}
    <div className="studio-field-pair">
      <button disabled={!edgeExists} onClick={()=>apply("Split shared edge",{
        type:"facet.splitEdge",id:part.id,a,b,vertexId:crypto.randomUUID(),
      })}>Split shared edge</button>
      <button disabled={!validPair || !face.vertices.includes(a) || !face.vertices.includes(b) || edgeExists}
        onClick={()=>apply("Cut face",{type:"facet.cut",id:part.id,faceId:face.id,a,b,nextFaceId:crypto.randomUUID()})}>Cut face</button>
    </div>
    <button disabled={!validPair} onClick={()=>apply("Weld vertices",{type:"facet.weld",id:part.id,retained:a,removed:b})}>Weld to vertex 1</button>
    <div className="studio-field-pair">
      <label>Mirror axis<select value={mirrorAxis} onChange={event=>setMirrorAxis(event.target.value as "x"|"y")}>
        <option value="x">Vertical</option><option value="y">Horizontal</option>
      </select></label>
      <label>Mirror line (px)<input type="number" value={mirrorLine} step="any" onChange={event=>setMirrorLine(event.target.value)}/></label>
    </div>
    <button disabled={!mirrorLine || !Number.isFinite(Number(mirrorLine))} onClick={()=>apply("Mirror artwork",{
      type:"facet.mirror",id:part.id,axis:mirrorAxis,at:Number(mirrorLine),prefix:crypto.randomUUID().slice(0,16),
    })}>Mirror facets</button>
    <div className="studio-field-pair">
      <button onClick={preview}>Preview triangulation</button>
      <button disabled={!state.triangulation} onClick={()=>apply("Triangulate face",{
        type:"facet.triangulate",id:part.id,faceId:face.id,prefix:crypto.randomUUID().slice(0,16),
      })}>Apply triangles</button>
    </div>
    {previewError && <p className="studio-key-error" role="alert">{previewError}</p>}
  </section>;
}
