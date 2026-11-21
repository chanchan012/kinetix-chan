import cssColor from "color-string";
import { transformGradientAxis, type PaintValue, type Stroke } from "./appearance";
import type { Bounds } from "./path-layout";
import { mapPartPoint, type PartMatrix } from "./part-transform";
import { multiply,scaling,svgLength,svgTransform,translation,type SvgAttributes,type SvgSize } from "./svg-geometry";
import { localSvgRef,svgUrl,type SvgNode,type SvgWarn } from "./svg-source";

const clamp=(n:number)=>Math.min(1,Math.max(0,n));
export const svgOpacity=(value?:string)=>clamp(svgLength(value,1,1));

function hsl(h:number,s:number,l:number) {
  const chroma=s*Math.min(l,1-l);
  return [0,8,4].map(n=>{
    const angle=(n+(h/30)%12+12)%12;
    return (l-chroma*Math.max(-1,Math.min(angle-3,9-angle,1)))*255;
  });
}

function color(value:string,foreground:string) {
  const raw=value.trim().toLowerCase();
  const source=raw==="currentcolor" ? (foreground.toLowerCase()==="currentcolor" ? "black" : foreground.toLowerCase()) : raw;
  const parsed=source.length<=256 ? cssColor.get(source) : null;
  if (!parsed || parsed.value.some(channel=>!Number.isFinite(channel))) throw new Error("Unsupported color " + JSON.stringify(value.slice(0,40)) + ".");
  const [first,second,third,alpha]=parsed.value;
  let rgb=parsed.value.slice(0,3);
  if (parsed.model==="hsl") rgb=hsl(first,second/100,third/100);
  if (parsed.model==="hwb") {
    const white=second/100;
    const black=third/100;
    rgb=white+black>=1 ? [0,0,0].map(()=>255*white/(white+black)) :
      hsl(first,1,0.5).map(channel=>channel*(1-white-black)+255*white);
  }
  return {color:"#"+rgb.map(channel=>Math.round(channel).toString(16).padStart(2,"0")).join(""),opacity:alpha ?? 1};
}

type ResolvedGradient={attributes:SvgAttributes;stops:SvgNode[];style:SvgAttributes};
type PaintSample={paint:PaintValue;opacity:number};

export function svgPaintReader(byId:Map<string,SvgNode>,resolve:(node:SvgNode,parent?:SvgAttributes)=>SvgAttributes,warn:SvgWarn) {
  function gradient(node:SvgNode,seen:Set<SvgNode>):ResolvedGradient {
    if (seen.has(node) || seen.size>=24) throw new Error("Circular or overly nested gradient reference.");
    let inherited:ResolvedGradient={attributes:{},stops:[],style:{}};
    if (node.attributes.href) {
      const source=byId.get(localSvgRef(node.attributes.href) ?? "");
      if (!source || source.tag!=="linearGradient") warn(node,"A gradient template must reference a local linear gradient.");
      else inherited=gradient(source,new Set([...seen,node]));
    }
    const stops=node.children.filter(child=>child.tag==="stop");
    const style=resolve(node,inherited.style);
    const attributes={...inherited.attributes,...node.attributes};
    for (const key of ["x1","y1","x2","y2"]) if (style[key]!==undefined) attributes[key]=style[key];
    return {attributes,stops:stops.length ? stops : inherited.stops,style:stops.length ? style : inherited.style};
  }

  function linear(node:SvgNode,box:Bounds,matrix:PartMatrix,space:SvgSize):PaintSample|null {
    const {attributes,stops,style}=gradient(node,new Set());
    if (!stops.length) return null;
    if (stops.length>16) throw new Error("A gradient exceeds the 16-stop edit limit.");
    if (attributes.spreadMethod && attributes.spreadMethod!=="pad") warn(node,"Repeating and reflected gradients use padded ends.");
    let previous=0;
    const colors=stops.map(stop=>{
      const values=resolve(stop,style);
      const ink=color(values["stop-color"] ?? "black",values.color ?? "black");
      const offset=previous=Math.max(previous,clamp(svgLength(stop.attributes.offset,1)));
      const opacity=ink.opacity*svgOpacity(values["stop-opacity"]);
      return {offset,color:ink.color,...(opacity!==1 && {opacity})};
    });
    const single=():PaintSample=>({paint:{kind:"solid",color:colors.at(-1)!.color},opacity:colors.at(-1)!.opacity ?? 1});
    const local=attributes.gradientUnits!=="userSpaceOnUse";
    if (attributes.gradientUnits && !["userSpaceOnUse","objectBoundingBox"].includes(attributes.gradientUnits)) {
      throw new Error("Unsupported gradientUnits.");
    }
    if (colors.length===1) return single();
    const width=box.max.x-box.min.x;
    const height=box.max.y-box.min.y;
    if (local && (width<=0 || height<=0)) return null;
    const boxMatrix=local ? multiply(translation(box.min.x,box.min.y),scaling(width,height)) : scaling(1);
    const map=multiply(matrix,multiply(boxMatrix,svgTransform(attributes.gradientTransform)));
    if (Math.abs(map[0]*map[3]-map[1]*map[2])<1e-12) return single();
    const x=local ? 1 : space.width;
    const y=local ? 1 : space.height;
    const start={x:svgLength(attributes.x1,x),y:svgLength(attributes.y1,y)};
    const end={x:svgLength(attributes.x2,x,x),y:svgLength(attributes.y2,y)};
    if (start.x===end.x && start.y===end.y) return single();
    const [from,to]=transformGradientAxis(start,end,point=>mapPartPoint(map,point));
    if (Math.hypot(from.x-to.x,from.y-to.y)<0.001) return single();
    return {paint:{kind:"linear",from,to,stops:colors},opacity:1};
  }

  return (node:SvgNode,value:string,style:SvgAttributes,box:Bounds,matrix:PartMatrix,space:SvgSize):PaintSample|null=>{
    const solid=(source:string) => {
      const decoded=color(source,style.color);
      return {paint:{kind:"solid" as const,color:decoded.color},opacity:decoded.opacity};
    };
    if (value.trim()==="none") return null;
    const url=svgUrl(value);
    if (url) {
      const definition=byId.get(localSvgRef(url[1] ?? url[2] ?? url[3]) ?? "");
      if (definition?.tag==="linearGradient") {
        try {return linear(definition,box,matrix,space);}
        catch (error) {warn(node,error instanceof Error ? error.message : "Could not read the linear gradient.");}
      } else warn(node,"This paint server is unsupported. Only local linear gradients are editable.");
      value=url[4] || "none";
    }
    try {return value==="none" ? null : solid(value);}
    catch (error) {warn(node,error instanceof Error ? error.message : "Could not read the paint color.");return null;}
  };
}

export function svgStroke(node:SvgNode,sample:PaintSample|null,style:SvgAttributes,matrix:PartMatrix,space:SvgSize,warn:SvgWarn):Stroke|null {
  if (!sample) return null;
  const [a,b,c,d]=matrix;
  const first=Math.hypot(a,b);
  const second=Math.hypot(c,d);
  const uniform=Math.abs(first-second)<Math.max(first,second)*1e-8 && Math.abs(a*c+b*d)<first*second*1e-8;
  const nonScaling=style["vector-effect"]==="non-scaling-stroke";
  const factor=nonScaling ? 1 : Math.sqrt(Math.abs(a*d-b*c));
  if (!nonScaling && !uniform) warn(node,"A nonuniform transform uses an averaged stroke width.");
  const diagonal=Math.hypot(space.width,space.height)/Math.SQRT2;
  const width=svgLength(style["stroke-width"],diagonal,1)*factor;
  if (width<=0) return null;
  const dash=style["stroke-dasharray"] && style["stroke-dasharray"]!=="none" ? style["stroke-dasharray"].trim().split(/[\s,]+/)
    .map(value=>svgLength(value,diagonal)*factor) : [];
  if (dash.some(value=>value<=0) && dash.some(value=>value>0)) warn(node,"Dash patterns with zero lengths use a continuous stroke.");
  const cap=style["stroke-linecap"];
  const join=style["stroke-linejoin"];
  if (join && !["miter","round","bevel"].includes(join)) warn(node,"This stroke join uses a miter join.");
  const opacity=sample.opacity*svgOpacity(style["stroke-opacity"]);
  return {paint:sample.paint,width,cap:cap==="round" || cap==="square" ? cap : "butt",join:join==="round" || join==="bevel" ? join : "miter",
    miter:svgLength(style["stroke-miterlimit"],1,4),dash:dash.every(value=>value>0) ? dash : [],
    offset:svgLength(style["stroke-dashoffset"],diagonal)*factor,...(opacity!==1 && {opacity})};
}
