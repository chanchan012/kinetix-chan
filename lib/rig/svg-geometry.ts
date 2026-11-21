import svgPath from "svgpath";
import type { Point, VectorKnot } from "./model";
import { primitiveKnots } from "./path-geometry";
import { mapPartPoint, type PartMatrix } from "./part-transform";

export type SvgAttributes = Record<string,string>;
export type SvgSize = {width:number;height:number};
export type SvgContour = {knots:VectorKnot[];closed:boolean};
export const svgIdentity:PartMatrix = [1,0,0,1,0,0];
export const translation = (x:number,y:number):PartMatrix => [1,0,0,1,x,y];
export const scaling = (x:number,y=x):PartMatrix => [x,0,0,y,0,0];

export function multiply(left:PartMatrix,right:PartMatrix):PartMatrix {
  const [a,b,c,d,e,f]=left;
  const [g,h,i,j,k,l]=right;
  return [a*g+c*h,b*g+d*h,a*i+c*j,b*i+d*j,a*k+c*l+e,b*k+d*l+f];
}

const numberPattern=String.raw`[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?`;
const units:Record<string,number>={"":1,px:1,pt:96/72,pc:16,in:96,cm:96/2.54,mm:96/25.4,q:96/101.6};
const finite = (number:number) => {
  if (!Number.isFinite(number) || Math.abs(number)>1_000_000) throw new Error("A coordinate is outside the editable range.");
  return number;
};

export function svgNumbers(source:string) {
  const values:number[]=[];
  let cursor=0;
  for (const match of source.matchAll(new RegExp(numberPattern,"g"))) {
    if (!/^[\s,]*$/.test(source.slice(cursor,match.index))) throw new Error("Invalid number list.");
    values.push(finite(Number(match[0])));
    cursor=match.index+match[0].length;
  }
  if (!/^[\s,]*$/.test(source.slice(cursor))) throw new Error("Invalid number list.");
  return values;
}

export function svgLength(value:string|undefined,reference:number,fallback=0) {
  if (value===undefined || value.trim()==="auto") return fallback;
  const match=new RegExp(`^(${numberPattern})(%|px|pt|pc|in|cm|mm|q)?$`,"i").exec(value.trim());
  if (!match) throw new Error("Unsupported length " + JSON.stringify(value.slice(0,40)) + ".");
  const unit=match[2]?.toLowerCase() ?? "";
  return finite(Number(match[1])*(unit==="%" ? reference/100 : units[unit]));
}

export function svgTransform(source?:string):PartMatrix {
  if (!source || source.trim()==="none") return svgIdentity;
  if (source.length>4096) throw new Error("This SVG transform exceeds the editable limit.");
  let result=svgIdentity;
  let end=0;
  for (const match of source.matchAll(/([A-Za-z]+)\s*\(([^()]*)\)/g)) {
    if (!/^[\s,]*$/.test(source.slice(end,match.index))) throw new Error("Invalid transform list.");
    end=match.index+match[0].length;
    const values=svgNumbers(match[2]);
    const [x,y,z]=values;
    const radians=x*Math.PI/180;
    let next:PartMatrix|undefined;
    switch (match[1]) {
      case "matrix": if (values.length===6) next=values as PartMatrix; break;
      case "translate": if (values.length===1 || values.length===2) next=translation(x,y ?? 0); break;
      case "scale": if (values.length===1 || values.length===2) next=scaling(x,y); break;
      case "rotate": {
        if (values.length!==1 && values.length!==3) break;
        const cosine=Math.cos(radians);
        const sine=Math.sin(radians);
        next=[cosine,sine,-sine,cosine,0,0];
        if (values.length===3) next=multiply(translation(y,z),multiply(next,translation(-y,-z)));
        break;
      }
      case "skewX": if (values.length===1) next=[1,0,Math.tan(radians),1,0,0]; break;
      case "skewY": if (values.length===1) next=[1,Math.tan(radians),0,1,0,0]; break;
    }
    if (!next) throw new Error("Unsupported or malformed SVG transform " + match[1] + ".");
    result=multiply(result,next);
    result.forEach(finite);
  }
  if (!end || !/^[\s,]*$/.test(source.slice(end))) throw new Error("Invalid transform list.");
  return result;
}

export function svgViewport(attributes:SvgAttributes,parent?:SvgSize) {
  const viewBox=attributes.viewBox===undefined ? undefined : svgNumbers(attributes.viewBox);
  if (viewBox && (viewBox.length!==4 || viewBox[2]<=0 || viewBox[3]<=0)) throw new Error("The SVG viewBox needs four values and a positive size.");
  const width=svgLength(attributes.width,parent?.width ?? viewBox?.[2] ?? 300,parent?.width ?? viewBox?.[2] ?? 300);
  const height=svgLength(attributes.height,parent?.height ?? viewBox?.[3] ?? 150,parent?.height ?? viewBox?.[3] ?? 150);
  if (width<=0 || height<=0) throw new Error("The SVG viewport needs a positive width and height.");
  const viewport={width,height};
  if (!viewBox) return {viewport,userSize:viewport,matrix:svgIdentity};
  const [left,top,viewWidth,viewHeight]=viewBox;
  const [align,mode="meet",...rest]=(attributes.preserveAspectRatio ?? "xMidYMid meet").trim().replace(/^defer\s+/,"").split(/\s+/);
  if (rest.length || !["meet","slice"].includes(mode) || (align!=="none" && !/^x(Min|Mid|Max)Y(Min|Mid|Max)$/.test(align))) {
    throw new Error("Invalid SVG preserveAspectRatio.");
  }
  const sx=width/viewWidth;
  const sy=height/viewHeight;
  const scale=mode==="slice" ? Math.max(sx,sy) : Math.min(sx,sy);
  const x=align==="none" ? sx : scale;
  const y=align==="none" ? sy : scale;
  const alignment=(axis:string) => axis==="Max"?1:axis==="Mid"?0.5:0;
  const offsetX=(width-viewWidth*x)*alignment(align.slice(1,4));
  const offsetY=(height-viewHeight*y)*alignment(align.slice(5,8));
  const matrix:PartMatrix=[x,0,0,y,offsetX-left*x,offsetY-top*y];
  return {viewport,userSize:{width:viewWidth,height:viewHeight},matrix};
}

const same = (a:Point,b:Point) => a.x===b.x && a.y===b.y;

export function readSvgPath(d:string):SvgContour[] {
  if (!d.trim()) return [];
  const path=svgPath(d) as ReturnType<typeof svgPath> & {err:string;segments:unknown[]};
  if (path.err) throw new Error("Malformed SVG path data.");
  if (path.segments.length>8192) throw new Error("The SVG path exceeds the segment limit.");
  const contours:SvgContour[]=[];
  let knots:VectorKnot[]=[];
  let start:Point={x:0,y:0};
  const point=(x:number,y:number):Point=>({x:finite(x),y:finite(y)});
  function finish(closed:boolean) {
    if (closed && knots.length>1 && same(knots[0].point,knots.at(-1)!.point)) {
      const last=knots.pop()!;
      if (last.incoming) knots[0].incoming=last.incoming;
    }
    if (knots.length>=2) contours.push({knots,closed});
    knots=[];
  }
  path.abs().unshort().unarc().iterate(segment=>{
    switch (segment[0]) {
      case "M": finish(false); start=point(segment[1],segment[2]); knots=[{point:start}]; return;
      case "Z": case "z": finish(true); return;
    }
    if (!knots.length) knots=[{point:start}];
    const last=knots.at(-1)!;
    switch (segment[0]) {
      case "L": knots.push({point:point(segment[1],segment[2])}); break;
      case "H": knots.push({point:point(segment[1],last.point.y)}); break;
      case "V": knots.push({point:point(last.point.x,segment[1])}); break;
      case "C":
        last.outgoing=point(segment[1],segment[2]);
        knots.push({point:point(segment[5],segment[6]),incoming:point(segment[3],segment[4])});
        break;
      case "Q": {
        const control=point(segment[1],segment[2]);
        const end=point(segment[3],segment[4]);
        const towards=(anchor:Point)=>point((anchor.x+2*control.x)/3,(anchor.y+2*control.y)/3);
        last.outgoing=towards(last.point);
        knots.push({point:end,incoming:towards(end)});
        break;
      }
      default: throw new Error("An SVG path segment could not be converted.");
    }
  });
  finish(false);
  return contours;
}

export const svgShapes=new Set(["path","rect","line","polygon","polyline","circle","ellipse"]);

export function shapeContours(tag:string,a:SvgAttributes,space:SvgSize):SvgContour[] {
  const x=(name:string,fallback=0)=>svgLength(a[name],space.width,fallback);
  const y=(name:string,fallback=0)=>svgLength(a[name],space.height,fallback);
  switch (tag) {
    case "path": return readSvgPath(a.d ?? "");
    case "polygon": case "polyline": {
      const points=svgNumbers(a.points ?? "");
      if (points.length%2) throw new Error("A point list requires x and y pairs.");
      const knots:VectorKnot[]=[];
      for (let i=0;i<points.length;i+=2) knots.push({point:{x:points[i],y:points[i+1]}});
      return knots.length>=2 ? [{knots,closed:tag==="polygon"}] : [];
    }
    case "line": return [{closed:false,knots:[{point:{x:x("x1"),y:y("y1")}},{point:{x:x("x2"),y:y("y2")}}]}];
    case "circle": case "ellipse": {
      const center={x:x("cx"),y:y("cy")};
      const radius=tag==="circle" ? svgLength(a.r,Math.hypot(space.width,space.height)/Math.SQRT2) : undefined;
      const rx=radius ?? x("rx");
      const ry=radius ?? y("ry");
      if (rx<=0 || ry<=0) return [];
      return [{closed:true,knots:primitiveKnots("ellipse",{x:center.x-rx,y:center.y-ry},{x:center.x+rx,y:center.y+ry},false)}];
    }
    case "rect": {
      const left=x("x"), top=y("y"), width=x("width"), height=y("height");
      if (width<=0 || height<=0) return [];
      const right=left+width, bottom=top+height;
      const rx=Math.max(0,Math.min(a.rx!==undefined ? x("rx") : y("ry"),width/2));
      const ry=Math.max(0,Math.min(a.ry!==undefined ? y("ry") : x("rx"),height/2));
      if (!rx || !ry) return [{closed:true,knots:primitiveKnots("rectangle",{x:left,y:top},{x:right,y:bottom},false)}];
      return readSvgPath(`M ${left+rx} ${top} H ${right-rx} A ${rx} ${ry} 0 0 1 ${right} ${top+ry} V ${bottom-ry} A ${rx} ${ry} 0 0 1 ${right-rx} ${bottom} H ${left+rx} A ${rx} ${ry} 0 0 1 ${left} ${bottom-ry} V ${top+ry} A ${rx} ${ry} 0 0 1 ${left+rx} ${top} Z`);
    }
    default: return [];
  }
}

export function transformKnots(knots:VectorKnot[],matrix:PartMatrix):VectorKnot[] {
  const map=(point:Point) => {
    const mapped=mapPartPoint(matrix,point);
    return {x:finite(mapped.x),y:finite(mapped.y)};
  };
  return knots.map(knot=>({...knot,point:map(knot.point),
    ...(knot.incoming && {incoming:map(knot.incoming)}),...(knot.outgoing && {outgoing:map(knot.outgoing)})}));
}
