import { describe,expect,it } from "vitest";
import { editRig } from "../../lib/rig/commands";
import { layerTreeFor,orderedLayers,orderedVisibleParts } from "../../lib/rig/layer-tree";
import { createBlankRig,readRigState,type VectorPart } from "../../lib/rig/model";

const path = (id:string):VectorPart => ({
  id,name:id,parentId:null,offset:{x:0,y:0},fill:"#b55422",closed:true,
  knots:[{point:{x:10,y:10}},{point:{x:50,y:10}},{point:{x:50,y:50}}],
});
const document = () => ({
  ...createBlankRig({name:"Badge",width:128,height:128,background:null}),
  parts:["badge","shine","label"].map(path),
});

describe("layer tree compatibility and nesting",()=>{
  it("reads unversioned layer order from existing part IDs and keeps render order after grouping",()=>{
    const legacy = document();
    expect(layerTreeFor(legacy).nodes.map(node=>node.id)).toEqual(["badge","shine","label"]);
    const [next] = editRig(legacy,[
      {type:"layer.group",id:"art",name:"Artwork",members:["badge","shine"]},
      {type:"layer.group",id:"effects",name:"Effects",members:["shine"]},
      {type:"layer.move",id:"label",parentId:"art",index:1},
    ]);
    expect(orderedLayers(next.layers!).map(({node,depth})=>[node.id,depth])).toEqual([
      ["art",0],["badge",1],["label",1],["effects",1],["shine",2],
    ]);
    expect(orderedVisibleParts(next).map(part=>part.id)).toEqual(["badge","label","shine"]);
    expect(readRigState(JSON.parse(JSON.stringify(next))).layers?.version).toBe(1);
    expect(legacy.parts.map(part=>part.id)).toEqual(["badge","shine","label"]);
  });

  it("inherits hide and lock flags and keeps the full edit transactional",()=>{
    const [next] = editRig(document(),[
      {type:"layer.group",id:"art",name:"Artwork",members:["badge","shine"]},
      {type:"layer.flags",id:"art",hidden:true,locked:true},
    ]);
    expect(orderedVisibleParts(next).map(part=>part.id)).toEqual(["label"]);
    expect(()=>editRig(next,[{type:"part.update",id:"shine",changes:{name:"Edited"}}])).toThrow("Unlock");
    expect(()=>editRig(next,[{type:"layer.move",id:"art",parentId:"art",index:0}])).toThrow();
    const [unwrapped] = editRig(next,[{type:"layer.ungroup",id:"art"}]);
    expect(unwrapped.layers?.nodes.slice(0,2)).toMatchObject([{parentId:null,hidden:true,locked:true},{parentId:null,hidden:true,locked:true}]);
  });

  it("copies a subtree with new IDs and keeps part additions and removals synchronized",()=>{
    const [next] = editRig(document(),[
      {type:"layer.group",id:"art",name:"Artwork",members:["badge","shine"]},
      {type:"layer.duplicate",id:"art",prefix:"replica"},
      {type:"part.remove",id:"replica-1"},
      {type:"part.create",part:path("new-path")},
    ]);
    expect(next.parts.map(part=>part.id)).toEqual(["badge","shine","label","replica-2","new-path"]);
    expect(orderedVisibleParts(next).map(part=>part.id)).toEqual(["badge","shine","replica-2","label","new-path"]);
  });
});
