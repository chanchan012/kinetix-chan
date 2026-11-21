import { SaxesParser } from "saxes";
import type { SvgAttributes } from "./svg-geometry";

export const svgImportByteLimit = 512 * 1024;
const svgNamespace="http://www.w3.org/2000/svg";
const xlinkNamespace="http://www.w3.org/1999/xlink";
const inkscapeNamespace="http://www.inkscape.org/namespaces/inkscape";

export type SvgNode = {tag:string;attributes:SvgAttributes;children:SvgNode[];text:string;line:number};
export type SvgDiagnostic = {element:string;line:number;message:string};
export type SvgWarn = (node:SvgNode,message:string)=>void;
export const svgName=(node:SvgNode,fallback:string) => (
  node.attributes.label || node.children.find(child=>child.tag==="title")?.text || node.attributes.id || fallback
).trim().slice(0,120) || fallback;

export function readSvgSource(source:string) {
  if (new TextEncoder().encode(source).length>svgImportByteLimit) throw new Error("Choose an SVG of 512 KB or less.");
  const parser=new SaxesParser({xmlns:true});
  const stack:SvgNode[]=[];
  const byId=new Map<string,SvgNode>();
  const styles:SvgNode[]=[];
  let root:SvgNode|undefined;
  let count=0;
  parser.on("doctype",()=>{throw new Error("SVG documents with a DOCTYPE are unsupported. Re-save the artwork without a document type declaration.");});
  parser.on("error",()=>{throw new Error(`Invalid SVG XML near line ${parser.line}.`);});
  parser.on("opentag",tag=>{
    if (++count>1600 || stack.length>=30) throw new Error("The SVG exceeds the element or nesting limit.");
    const attributes:SvgAttributes=Object.create(null);
    for (const entry of Object.values(tag.attributes)) {
      if (!entry.uri || entry.uri===xlinkNamespace || (entry.uri===inkscapeNamespace && entry.local==="label")) {
        // An unprefixed SVG 2 href supersedes the older xlink spelling.
        if (entry.uri!==xlinkNamespace || attributes[entry.local]===undefined) attributes[entry.local]=entry.value;
      }
    }
    const node:SvgNode={tag:tag.uri && tag.uri!==svgNamespace ? "foreign-element" : tag.local,
      attributes,children:[],text:"",line:parser.line};
    if (attributes.id && node.tag!=="foreign-element" && !byId.has(attributes.id)) byId.set(attributes.id,node);
    if (node.tag==="style") styles.push(node);
    if (stack.length) stack.at(-1)!.children.push(node);
    else root=node;
    stack.push(node);
  });
  parser.on("closetag",()=>{stack.pop();});
  const text=(value:string)=>{
    const node=stack.at(-1);
    if (node && (node.tag==="title" || node.tag==="style")) node.text+=value;
  };
  parser.on("text",text);
  parser.on("cdata",text);
  parser.write(source).close();
  if (!root || root.tag!=="svg") throw new Error("Choose a file with a root SVG element.");
  return {root,byId,styles};
}

const inherited=new Set([
  "color","fill","fill-rule","fill-opacity","clip-rule","visibility","stroke","stroke-width","stroke-opacity",
  "stroke-linecap","stroke-linejoin","stroke-miterlimit","stroke-dasharray","stroke-dashoffset",
]);
const styleProperties=new Set([...inherited,"opacity","display","overflow","clip-path","stop-color","stop-opacity","vector-effect",
  "filter","mask","mix-blend-mode","paint-order","marker","marker-start","marker-mid","marker-end","transform","transform-origin",
  "color-interpolation","x","y","x1","y1","x2","y2","cx","cy","r","rx","ry","width","height","d"]);
const defaults:SvgAttributes={fill:"black",color:"black",stroke:"none",visibility:"visible"};

type Selector={tag?:string;id?:string;classes:string[];weight:number};
type Rule={selector:Selector;style:SvgAttributes};

function selector(source:string):Selector|undefined {
  const valid=/^([a-z][\w-]*|\*)?((?:[.#][\w-]+)*)$/i.exec(source);
  if (!valid || !source) return;
  const tag=valid[1]==="*" ? undefined : valid[1];
  const ids=[...valid[2].matchAll(/#([\w-]+)/g)].map(match=>match[1]);
  const classes=[...valid[2].matchAll(/\.([\w-]+)/g)].map(match=>match[1]);
  if (ids.length>1) return;
  return {tag,id:ids[0],classes,weight:ids.length*10_000+classes.length*100+Number(Boolean(tag))};
}

function declarations(source:string,node:SvgNode,warn:SvgWarn):SvgAttributes {
  const result:SvgAttributes=Object.create(null);
  for (const item of source.split(";")) {
    const boundary=item.indexOf(":");
    if (boundary<0) continue;
    const key=item.slice(0,boundary).trim().toLowerCase();
    if (!styleProperties.has(key)) continue;
    const value=item.slice(boundary+1).trim();
    if (/!important\s*$/i.test(value)) warn(node,"CSS !important precedence isn’t preserved.");
    result[key]=value.replace(/\s*!important\s*$/i,"");
  }
  return result;
}

export function svgStyleResolver(sheets:SvgNode[],warn:SvgWarn) {
  const rules:Rule[]=[];
  for (const sheet of sheets) {
    const sections:string[]=[];
    let cursor=0;
    for (let comment=sheet.text.indexOf("/*",cursor);comment>=0;comment=sheet.text.indexOf("/*",cursor)) {
      sections.push(sheet.text.slice(cursor,comment));
      const end=sheet.text.indexOf("*/",comment+2);
      cursor=end<0 ? sheet.text.length : end+2;
    }
    sections.push(sheet.text.slice(cursor));
    const source=sections.join("");
    if (/(?:^|[{};])\s*@/.test(source)) {
      warn(sheet,"A stylesheet containing CSS at-rules was skipped. Use inline styles or local class rules.");
      continue;
    }
    cursor=0;
    while (cursor<source.length) {
      const open=source.indexOf("{",cursor);
      if (open<0) {
        if (source.slice(cursor).trim()) warn(sheet,"Incomplete stylesheet rules were skipped.");
        break;
      }
      const close=source.indexOf("}",open+1);
      if (close<0 || source.slice(open+1,close).includes("{")) {
        warn(sheet,"Nested or incomplete stylesheet rules were skipped.");
        break;
      }
      const style=declarations(source.slice(open+1,close),sheet,warn);
      const selectors=source.slice(cursor,open);
      cursor=close+1;
      if (selectors.length>2048) {
        warn(sheet,"A stylesheet selector list exceeded the editable limit.");
        continue;
      }
      for (const item of selectors.split(",")) {
        const decoded=selector(item.trim());
        if (decoded) rules.push({selector:decoded,style});
        else warn(sheet,"A CSS selector is unsupported. Convert it to an inline style or a simple class selector.");
        if (rules.length>512) throw new Error("The SVG exceeds the stylesheet rule limit.");
      }
    }
  }
  rules.sort((a,b)=>a.selector.weight-b.selector.weight);
  return (node:SvgNode,parent:SvgAttributes={}) => {
    const style:SvgAttributes={...defaults};
    for (const key of inherited) if (parent[key]!==undefined) style[key]=parent[key];
    const explicit:SvgAttributes=Object.create(null);
    for (const key of styleProperties) if (node.attributes[key]!==undefined) explicit[key]=node.attributes[key];
    const classes=new Set((node.attributes.class ?? "").split(/\s+/));
    for (const {selector,style} of rules) {
      if ((!selector.tag || selector.tag===node.tag) && (!selector.id || selector.id===node.attributes.id) &&
          selector.classes.every(value=>classes.has(value))) Object.assign(explicit,style);
    }
    Object.assign(explicit,declarations(node.attributes.style ?? "",node,warn));
    for (const [key,value] of Object.entries(explicit)) {
      if (value==="inherit" || (value==="unset" && inherited.has(key))) {
        if (parent[key]!==undefined) style[key]=parent[key];
      } else if (value==="initial" || value==="unset") {
        if (defaults[key]!==undefined) style[key]=defaults[key];
        else delete style[key];
      } else style[key]=value;
    }
    return style;
  };
}

export function localSvgRef(value:string|undefined) {
  return /^#([^\s"'<>#]+)$/.exec(value?.trim() ?? "")?.[1];
}

export function svgUrl(value:string) {
  return /^url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s)]+))\s*\)\s*(.*)$/i.exec(value.trim());
}
