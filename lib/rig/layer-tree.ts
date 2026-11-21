import { z } from "zod";
import type { KinetixRigState,VectorPart } from "./model";
import { imagePlacementSchema } from "./images";

export const layerId = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
const nodeFields = {id:layerId,parentId:layerId.nullable(),hidden:z.boolean().optional(),locked:z.boolean().optional(),
  maskPartId:layerId.optional()};
const layerNodeSchema = z.discriminatedUnion("kind",[
  z.strictObject({...nodeFields,kind:z.literal("part"),partId:layerId}),
  z.strictObject({...nodeFields,kind:z.literal("drawing"),drawingId:layerId}),
  z.strictObject({...nodeFields,kind:z.literal("image"),placement:imagePlacementSchema}),
  z.strictObject({...nodeFields,kind:z.literal("group"),name:z.string().trim().min(1).max(120)}),
]);
export const layerTreeSchema = z.strictObject({version:z.literal(1),nodes:z.array(layerNodeSchema).max(256)})
  .superRefine((tree,context)=>{
    const lookup = new Map(tree.nodes.map(node=>[node.id,node]));
    const parts = new Set<string>();
    if (lookup.size!==tree.nodes.length) context.addIssue({
      code:"custom",path:["nodes"],message:"Layer IDs must be unique.",
    });
    for (const [index,node] of tree.nodes.entries()) {
      if (node.kind==="part") {
        if (parts.has(node.partId)) context.addIssue({
          code:"custom",path:["nodes",index,"partId"],message:"Each artwork part belongs to one layer.",
        });
        parts.add(node.partId);
      }
      const visited = new Set([node.id]);
      let parent = node.parentId;
      while (parent!==null) {
        const target = lookup.get(parent);
        if (target?.kind!=="group" || visited.has(parent) || visited.size>=32) {
          context.addIssue({code:"custom",path:["nodes",index,"parentId"],
            message:"Choose an existing group without a cycle or more than 32 levels of nesting."});
          break;
        }
        visited.add(parent);
        parent = target.parentId;
      }
    }
  });

export type LayerTree = z.infer<typeof layerTreeSchema>;
export type LayerNode = z.infer<typeof layerNodeSchema>;
export type ImageLayer = Extract<LayerNode,{kind:"image"}>;
type LayerSource = Pick<KinetixRigState,"parts"|"layers"|"drawings">;

/** Derive earlier documents' root layer order from their original part array. */
export function layerTreeFor(rig:LayerSource):LayerTree {
  return rig.layers ?? {version:1,nodes:[
    ...rig.parts.map(part=>partLayer(part.id)),
    ...(rig.drawings?.layers ?? []).map(({id}):LayerNode=>({kind:"drawing",id,parentId:null,drawingId:id})),
  ]};
}

export function partLayer(id:string):LayerNode {
  return {kind:"part",id,parentId:null,partId:id};
}

export function orderedLayers(tree:LayerTree) {
  const children = new Map<string|null,LayerNode[]>();
  for (const node of tree.nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId,siblings);
  }
  const result:{node:LayerNode;depth:number;hidden:boolean;locked:boolean;masks:string[]}[] = [];
  function visit(parentId:string|null,depth:number,hidden:boolean,locked:boolean,masks:string[]) {
    for (const node of children.get(parentId) ?? []) {
      const row = {node,depth,hidden:hidden || node.hidden===true,locked:locked || node.locked===true,
        masks:node.maskPartId ? [...masks,node.maskPartId] : masks};
      result.push(row);
      if (node.kind==="group") visit(node.id,depth+1,row.hidden,row.locked,row.masks);
    }
  }
  visit(null,0,false,false,[]);
  return result;
}

export function inLayerSubtree(tree:LayerTree,id:string):Set<string> {
  const included = new Set<string>([id]);
  for (const {node} of orderedLayers(tree)) {
    if (node.parentId && included.has(node.parentId)) included.add(node.id);
  }
  return included;
}

export function orderedVisibleParts(rig:LayerSource,isolate?:string|null):VectorPart[] {
  if (!rig.layers && !isolate) return rig.parts;
  const parts = new Map(rig.parts.map(part=>[part.id,part]));
  return visibleLayerRows(rig,isolate).flatMap(({node})=>
    node.kind==="part" ? [parts.get(node.partId)!] : []);
}

export function visibleLayerRows(rig:LayerSource,isolate?:string|null) {
  const tree = layerTreeFor(rig);
  const allowed = isolate ? inLayerSubtree(tree,isolate) : null;
  return orderedLayers(tree).filter(({node,hidden})=>node.kind!=="group" && !hidden && (!allowed || allowed.has(node.id)));
}

export function renderedImages(rig:KinetixRigState) {
  return visibleLayerRows(rig).flatMap(({node})=>
    node.kind==="image" && node.placement.mode==="artwork" && node.placement.opacity>0 ? [node] : []);
}

export function hasMissingArtworkImages(rig:KinetixRigState) {
  const embedded=new Set(rig.images?.sources.map(source=>source.sha256));
  const loaded=new Set(rig.images?.assets.filter(asset=>embedded.has(asset.sha256)).map(asset=>asset.id));
  return renderedImages(rig).some(node=>!loaded.has(node.placement.assetId));
}

export function editablePartIds(rig:LayerSource):Set<string> {
  return new Set(orderedLayers(layerTreeFor(rig)).flatMap(row=>
    row.node.kind==="part" && !row.hidden && !row.locked ? [row.node.partId] : []));
}

export function syncPartLayers(tree:LayerTree,parts:readonly VectorPart[]) {
  const ids = new Set(parts.map(part=>part.id));
  const existing = new Set(tree.nodes.flatMap(node=>node.kind==="part" ? [node.partId] : []));
  if ([...existing].some(id=>!ids.has(id))) tree.nodes = tree.nodes.filter(node=>node.kind!=="part" || ids.has(node.partId));
  for (const {id} of parts) if (!existing.has(id)) tree.nodes.push(partLayer(id));
  for (const node of tree.nodes) {
    if (node.maskPartId && !ids.has(node.maskPartId)) delete node.maskPartId;
  }
}

export function moveLayer(tree:LayerTree,id:string,parentId:string|null,index:number) {
  const old = tree.nodes.findIndex(layer=>layer.id===id);
  const layer = tree.nodes[old];
  if (!layer) throw new Error("The layer does not exist.");
  tree.nodes.splice(old,1);
  layer.parentId = parentId;
  const siblings = tree.nodes.filter(node=>node.parentId===parentId);
  const before = siblings[index];
  if (before) tree.nodes.splice(tree.nodes.indexOf(before),0,layer);
  else if (siblings.length) tree.nodes.splice(tree.nodes.indexOf(siblings.at(-1)!)+1,0,layer);
  else tree.nodes.push(layer);
}

export function groupLayers(tree:LayerTree,id:string,name:string,members:readonly string[]) {
  const selected = new Set(members);
  const nodes = tree.nodes.filter(node=>selected.has(node.id));
  if (!nodes.length || selected.size!==nodes.length || nodes.some(node=>node.parentId!==nodes[0].parentId)) {
    throw new Error("Choose sibling layers to group.");
  }
  const first = tree.nodes.indexOf(nodes[0]);
  tree.nodes.splice(first,0,{kind:"group",id,name,parentId:nodes[0].parentId});
  for (const node of nodes) node.parentId = id;
}

export function ungroupLayer(tree:LayerTree,id:string) {
  const index = tree.nodes.findIndex(node=>node.id===id && node.kind==="group");
  const group = tree.nodes[index];
  if (!group) throw new Error("Choose an existing group.");
  const children = tree.nodes.filter(node=>node.parentId===id)
    .map(node=>({...node,parentId:group.parentId,
      ...(group.hidden && {hidden:true}),...(group.locked && {locked:true})}));
  const before = tree.nodes.slice(0,index).filter(node=>node.parentId!==id);
  const after = tree.nodes.slice(index+1).filter(node=>node.parentId!==id);
  tree.nodes = [...before,...children,...after];
}
