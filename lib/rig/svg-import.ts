import clipping from "polygon-clipping";
import type { RigCommand } from "./commands";
import type { Appearance } from "./appearance";
import { svgStroke,svgOpacity,svgPaintReader } from "./svg-paint";
import { partSchema,type VectorPart,type VectorKnot } from "./model";
import { pointBounds,worldPartBounds,type Bounds } from "./path-layout";
import { splitPathEdge } from "./path-geometry";
import { pathRegions,regionPolygons } from "./path-boolean";
import type { PartMatrix } from "./part-transform";
import {multiply,scaling,shapeContours,svgIdentity,svgLength,svgShapes,svgTransform,svgViewport,transformKnots,translation,
  type SvgAttributes,type SvgContour,type SvgSize} from "./svg-geometry";
import {localSvgRef,readSvgSource,svgName,svgStyleResolver,svgUrl,type SvgDiagnostic,type SvgNode,type SvgWarn} from "./svg-source";

export { svgImportByteLimit } from "./svg-source";
type LayerEntry = {id:string;hidden:boolean;mask?:string};
type GroupEntry = LayerEntry & {name:string;children:Entry[]};
type Entry = (LayerEntry & {part:VectorPart}) | GroupEntry;
type Geometry = Pick<VectorPart,"knots"|"contours"|"closed">;
type Options = {name?:string;importId:string;fit?:SvgSize};
const noBones=new Map();
const refsIgnored=new Set(["desc","title","metadata","defs","style","linearGradient","radialGradient","clipPath","mask","pattern","symbol","filter","marker"]);
const label=(source:string)=>source.trim().slice(0,120) || "SVG artwork";

function barePath(geometry:Geometry):VectorPart {
  return {id:"path",name:"Path",parentId:null,offset:{x:0,y:0},fill:"#000000",...geometry};
}

function closedContours(contours:SvgContour[]) {
  return contours.filter(({knots})=>knots.length>=3 || knots.some(knot=>knot.incoming || knot.outgoing)).map(({knots})=>
    knots.length<3 ? splitPathEdge(barePath({knots,closed:true}),0) : knots);
}

function compound(rings:VectorKnot[][]):Geometry {
  const primary=rings.findIndex(ring=>ring.length<=256);
  if (primary<0 || rings.length>129 || rings.some(ring=>ring.length>2048) || rings.reduce((size,ring)=>size+ring.length,0)>4096) {
    throw new Error("This path exceeds the editable contour or node limit.");
  }
  return {knots:rings[primary],closed:true,...(rings.length>1 && {contours:rings.filter((_,index)=>index!==primary)})};
}

function geometryBounds(contours:SvgContour[],matrix:PartMatrix=svgIdentity) {
  const bounds=contours.map(contour=>worldPartBounds(barePath({...contour,knots:transformKnots(contour.knots,matrix)}),noBones));
  return bounds.length ? pointBounds(bounds.flatMap(box=>[box.min,box.max])) : undefined;
}

const boxContours=(width:number,height:number)=>shapeContours("rect",{width:String(width),height:String(height)},{width,height});

export function planSvgImport(svg:string,{name,importId,fit}:Options) {
  if (!/^[a-zA-Z0-9_-]{1,44}$/.test(importId)) throw new Error("Choose a valid SVG import ID.");
  const {root,byId,styles}=readSvgSource(svg);
  const diagnostics:SvgDiagnostic[]=[];
  const reported=new Set<string>();
  const warn:SvgWarn=(node,message)=>{
    const element=node.tag+(node.attributes.id ? " #"+node.attributes.id.slice(0,80) : "");
    const key=`${node.line}\n${element}\n${message}`;
    if (reported.has(key)) return;
    reported.add(key);
    if (diagnostics.length<50) diagnostics.push({element,line:node.line,message});
  };
  const resolve=svgStyleResolver(styles,warn);
  const readPaint=svgPaintReader(byId,resolve,warn);
  const masks:Entry[]=[];
  let idIndex=0;
  let visited=0;
  let partCount=0;
  let groupCount=0;
  let knotCount=0;
  let sampledKnots=0;
  const nextId=()=>`svg-${importId}-${idIndex++}`;
  const checkVisit=()=>{
    if (++visited>6000) throw new RangeError("The SVG exceeds the expanded geometry limit.");
  };
  const report=(node:SvgNode,error:unknown)=>{
    if (error instanceof RangeError) throw error;
    warn(node,error instanceof Error ? error.message : "Could not convert this SVG element.");
  };
  function part(geometry:Geometry,name:string,hidden:boolean,appearance?:Appearance,fillRule?:CanvasFillRule):Entry {
    if ((knotCount+=geometry.knots.length+(geometry.contours?.reduce((length,ring)=>length+ring.length,0) ?? 0))>12_000) {
      throw new RangeError("The SVG exceeds the total editable node limit. Import it in smaller sections.");
    }
    const id=nextId();
    const color=appearance?.fill?.kind==="solid" ? appearance.fill.color : "#000000";
    const shape:VectorPart={...barePath(geometry),id,name:label(name),fill:color,...(fillRule && {fillRule}),...(appearance && {appearance})};
    const validation=partSchema.safeParse(shape);
    if (!validation.success) throw new Error("This path exceeds Kinetix’s coordinate, stroke, or contour limits.");
    return {id,part:shape,hidden};
  }
  function group(name:string,children:Entry[],hidden=false):GroupEntry {
    return {id:nextId(),name:label(name),children,hidden};
  }
  function shape(node:SvgNode,style:SvgAttributes,space:SvgSize) {
    const contours=shapeContours(node.tag,{...node.attributes,...style},space);
    sampledKnots+=contours.reduce((total,contour)=>total+contour.knots.length,0);
    if (sampledKnots>48_000) throw new RangeError("The SVG exceeds the expanded node limit. Import it in smaller sections.");
    return contours;
  }

  function referenced(node:SvgNode,chain:ReadonlySet<SvgNode>) {
    const target=byId.get(localSvgRef(node.attributes.href) ?? "");
    if (!target || !(svgShapes.has(target.tag) || ["g","svg","symbol","use"].includes(target.tag))) {
      warn(node,"This use element must reference a local path, group, or symbol.");
      return;
    }
    if (chain.has(target) || chain.size>=20) {
      warn(node,"Circular or overly nested use reference was skipped.");
      return;
    }
    const attributes={...target.attributes};
    if (target.tag==="svg" || target.tag==="symbol") {
      for (const key of ["width","height"]) if (node.attributes[key]!==undefined) attributes[key]=node.attributes[key];
    }
    return {target:{...target,tag:target.tag==="symbol" ? "svg" : target.tag,attributes},chain:new Set([...chain,target])};
  }

  const position=(style:SvgAttributes,space:SvgSize) => translation(svgLength(style.x,space.width),svgLength(style.y,space.height));

  function localBounds(node:SvgNode,style:SvgAttributes,space:SvgSize,chain:ReadonlySet<SvgNode>):Bounds|undefined {
    if (svgShapes.has(node.tag)) return geometryBounds(shape(node,style,space));
    if (node.tag==="use") {
      const reference=referenced(node,chain);
      if (!reference) return;
      return geometryBounds(sourceGeometry(reference.target,style,position(style,space),space,reference.chain).flatMap(value=>value.contours));
    }
    return geometryBounds(node.children.flatMap(child=>sourceGeometry(child,style,svgIdentity,space,chain))
      .flatMap(value=>value.contours));
  }

  function sourceGeometry(node:SvgNode,parent:SvgAttributes,outer:PartMatrix,space:SvgSize,chain:ReadonlySet<SvgNode>):
    {contours:SvgContour[];rule:CanvasFillRule}[] {
    checkVisit();
    const style=resolve(node,parent);
    if (style.display==="none") return [];
    const matrix=multiply(outer,svgTransform(style.transform));
    if (node.tag==="use") {
      const reference=referenced(node,chain);
      return reference ? sourceGeometry(reference.target,style,multiply(matrix,position(style,space)),space,reference.chain) : [];
    }
    if (["g","svg","clipPath","a"].includes(node.tag)) {
      const view=node.tag==="svg" ? svgViewport({...node.attributes,...style},space) : null;
      const transformed=view ? multiply(multiply(matrix,position(style,space)),view.matrix) : matrix;
      return node.children.flatMap(child=>sourceGeometry(child,style,transformed,view?.userSize ?? space,chain));
    }
    if (style.visibility==="hidden" || style.visibility==="collapse" || !svgShapes.has(node.tag)) return [];
    const contours=shape(node,style,space).map(contour=>({...contour,knots:transformKnots(contour.knots,matrix)}));
    return [{contours,rule:style["clip-rule"]==="evenodd" ? "evenodd" : "nonzero"}];
  }

  function viewportMask(view:SvgSize,matrix:PartMatrix) {
    const [rectangle]=boxContours(view.width,view.height);
    const mask=part({...rectangle,knots:transformKnots(rectangle.knots,matrix)},"SVG viewport",false);
    masks.push(mask);
    return mask.id;
  }

  function applyClip(entry:Entry,node:SvgNode,style:SvgAttributes,matrix:PartMatrix,space:SvgSize,chain:ReadonlySet<SvgNode>) {
    const clip=style["clip-path"];
    if (!clip || clip==="none") return;
    const url=svgUrl(clip);
    const definition=byId.get(localSvgRef(url && !url[4] ? url[1] ?? url[2] ?? url[3] : undefined) ?? "");
    if (definition?.tag!=="clipPath") {warn(node,"Only local vector clip paths are editable.");return;}
    try {
      const local=definition.attributes.clipPathUnits==="objectBoundingBox";
      if (definition.attributes.clipPathUnits && !local && definition.attributes.clipPathUnits!=="userSpaceOnUse") {
        throw new Error("Unsupported clipPathUnits.");
      }
      const box=local ? localBounds(node,style,space,chain) : null;
      let transform=matrix;
      if (local) {
        if (!box || box.max.x===box.min.x || box.max.y===box.min.y) {entry.hidden=true;return;}
        transform=multiply(transform,multiply(translation(box.min.x,box.min.y),scaling(box.max.x-box.min.x,box.max.y-box.min.y)));
      }
      const paths=sourceGeometry(definition,{},transform,local ? {width:1,height:1} : space,chain).flatMap(({contours,rule})=>{
        const rings=closedContours(contours);
        return rings.length ? [{...barePath(compound(rings)),fillRule:rule}] : [];
      });
      const regions=paths.map(path=>pathRegions(path,noBones)).filter(region=>region.length);
      if (!regions.length) {entry.hidden=true;return;}
      const geometry=paths.length===1 ? paths[0] : compound(regionPolygons(clipping.union(regions[0],...regions.slice(1)))
        .map(points=>points.map(point=>({point}))));
      const mask=part({knots:geometry.knots,contours:geometry.contours,closed:true},svgName(definition,"Clip path"),false,undefined,
        paths.length===1 ? paths[0].fillRule : "evenodd");
      masks.push(mask);
      entry.mask=mask.id;
    } catch (error) {report(node,error);}
  }

  function vector(node:SvgNode,style:SvgAttributes,matrix:PartMatrix,space:SvgSize,opacity:number,hidden:boolean) {
    const contours=shape(node,style,space);
    const box=geometryBounds(contours);
    if (!box) return;
    const paint=readPaint(node,style.fill,style,box,matrix,space);
    let stroke=null;
    try {stroke=svgStroke(node,readPaint(node,style.stroke,style,box,matrix,space),style,matrix,space,warn);}
    catch (error) {report(node,error);}
    if (opacity!==1 && paint && stroke) warn(node,"Fill and stroke opacity are applied separately and may differ where they overlap.");
    const fillOpacity=svgOpacity(style["fill-opacity"])*(paint?.opacity ?? 1);
    const fillRule=style["fill-rule"]==="evenodd" ? "evenodd" : "nonzero";
    const localName=svgName(node,node.tag[0].toUpperCase()+node.tag.slice(1));
    const parts:Entry[]=[];
    const closed=closedContours(contours).map(knots=>transformKnots(knots,matrix));
    const strokeFitsFill=Boolean(stroke && contours.every(contour=>contour.closed));
    const visual:Appearance={fill:paint?.paint ?? null,stroke:strokeFitsFill ? stroke : null,
      ...(opacity!==1 && {opacity}),...(fillOpacity!==1 && {fillOpacity})};
    // A fill closes open subpaths implicitly. Keep their real open stroke in its own editable path.
    if (closed.length && (paint || strokeFitsFill)) parts.push(part(compound(closed),localName,hidden,visual,fillRule));
    if (stroke && (!strokeFitsFill || !parts.length)) {
      for (const contour of contours) parts.push(part({...contour,knots:transformKnots(contour.knots,matrix)},
        parts.length || contours.length>1 ? localName+" stroke" : localName,hidden,{...visual,fill:null,stroke}));
    }
    if (!parts.length) return;
    partCount+=parts.length;
    return parts.length===1 ? parts[0] : group(localName,parts,hidden);
  }

  function visit(node:SvgNode,parent:SvgAttributes,outer:PartMatrix,space:SvgSize,alpha:number,chain:ReadonlySet<SvgNode>):Entry[] {
    checkVisit();
    if (refsIgnored.has(node.tag)) return [];
    try {
      const style=resolve(node,parent);
      const matrix=multiply(outer,svgTransform(style.transform));
      if (Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2])<1e-12) return [];
      const own=svgOpacity(style.opacity);
      const opacity=alpha*own;
      const hidden=style.display==="none" || opacity===0;
      for (const property of ["filter","mask","mix-blend-mode","marker","marker-start","marker-mid","marker-end","paint-order","transform-origin","color-interpolation"]) {
        if (style[property] && !["none","normal","sRGB"].includes(style[property])) warn(node,`${property} isn’t preserved in editable artwork.`);
      }
      let entry:Entry|undefined;
      if (node.tag==="use") {
        const reference=referenced(node,chain);
        if (!reference) return [];
        const items=visit(reference.target,style,multiply(matrix,position(style,space)),space,opacity,reference.chain);
        if (items.length) {entry=group(svgName(node,"Instance"),items,hidden);groupCount++;}
      } else if (["g","a","svg"].includes(node.tag)) {
        const view=node.tag==="svg" ? svgViewport({...node.attributes,...style},space) : null;
        const placement=view ? multiply(matrix,position(style,space)) : matrix;
        const children=node.children.flatMap(child=>visit(child,style,view ? multiply(placement,view.matrix) : matrix,
          view?.userSize ?? space,opacity,chain));
        if (children.length) {
          if (own>0 && own<1 && children.length>1) warn(node,"Group opacity is applied per path and may differ where layers overlap.");
          entry=group(svgName(node,"Group"),children,hidden);
          groupCount++;
          if (view && style.overflow!=="visible") {
            applyClip(entry,node,style,multiply(placement,view.matrix),view.userSize,chain);
            const container=group(svgName(node,"SVG viewport"),[entry],hidden);
            container.mask=viewportMask(view.viewport,placement);
            return [container];
          }
        }
      } else if (svgShapes.has(node.tag)) {
        entry=vector(node,style,matrix,space,opacity,hidden || style.visibility==="hidden" || style.visibility==="collapse");
      } else {
        warn(node,`<${node.tag}> isn’t editable and was skipped.`);
      }
      if (!entry) return [];
      applyClip(entry,node,style,matrix,space,chain);
      return [entry];
    } catch (error) {report(node,error);return [];}
  }

  const rootStyle=resolve(root);
  const {viewport,userSize,matrix}=svgViewport({...root.attributes,...rootStyle});
  const scale=fit ? Math.min(1,fit.width/viewport.width,fit.height/viewport.height) : 1;
  const placement=fit ? multiply(translation((fit.width-viewport.width*scale)/2,(fit.height-viewport.height*scale)/2),scaling(scale)) : svgIdentity;
  const origin=multiply(placement,svgTransform(rootStyle.transform));
  const transform=multiply(origin,matrix);
  const rootOpacity=svgOpacity(rootStyle.opacity);
  const children=root.children.flatMap(child=>visit(child,rootStyle,transform,userSize,rootOpacity,new Set()));
  if (rootOpacity>0 && rootOpacity<1 && children.length>1) warn(root,"Group opacity is applied per path and may differ where layers overlap.");
  const importName=label(name ?? svgName(root,"SVG artwork"));
  const imported=group(importName,children,rootStyle.display==="none" || rootOpacity===0);
  const commands:RigCommand[]=[];
  if (children.length) {
    applyClip(imported,root,rootStyle,transform,userSize,new Set());
    if (rootStyle.overflow!=="visible") {
      const mask=viewportMask(viewport,origin);
      if (imported.mask) imported.children=[{...group("SVG content",children),mask:imported.mask}];
      imported.mask=mask;
    }
    if (masks.length) imported.children.push(group("Clipping paths",masks,true));
    function append(entry:Entry) {
      if ("part" in entry) commands.push({type:"part.create",part:entry.part});
      else {
        entry.children.forEach(append);
        commands.push({type:"layer.group",id:entry.id,name:entry.name,members:entry.children.map(child=>child.id)});
      }
      if (entry.hidden) commands.push({type:"layer.flags",id:entry.id,hidden:true});
    }
    append(imported);
    function addMasks(entry:Entry) {
      if (entry.mask) commands.push({type:"layer.mask",id:entry.id,partId:entry.mask});
      if ("children" in entry) entry.children.forEach(addMasks);
    }
    addMasks(imported);
    if (commands.length>100) throw new Error("The SVG needs more than 100 edits. Import a smaller section or simplify the artwork.");
  }
  return {name:importName,groupId:imported.id,partCount,groupCount,maskCount:masks.length,viewport,
    placement:{x:placement[4],y:placement[5],scale},diagnostics,additionalDiagnostics:reported.size-diagnostics.length,commands};
}

export type SvgImportPlan=ReturnType<typeof planSvgImport>;
