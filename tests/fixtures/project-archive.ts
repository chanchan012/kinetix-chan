import { planSpriteAtlas } from "../../lib/import/sprite-atlas";
import { createBlankRig } from "../../lib/rig/model";
import { editRig,type RigCommand } from "../../lib/rig/commands";
import { linearEase,type Track } from "../../lib/rig/animation";
import { exportedAtlasFixture } from "./sprite-atlas";

export const projectArtboard={name:"Animation handoff",width:16,height:16,background:null};
export const archivePart="kite";
export const archiveCommands:RigCommand[]=[
  {type:"part.create",part:{id:archivePart,name:"Kite",parentId:null,offset:{x:0,y:0},fill:"#44aaff",closed:true,
    knots:[{point:{x:1,y:8}},{point:{x:5,y:8}},{point:{x:3,y:13}}]}},
  {type:"facet.initialize",id:archivePart,faceId:"kite-face"},
  {type:"layer.group",id:"kite-group",name:"Kite artwork",members:[archivePart]},
];
export const archiveTracks:Track[]=[{channel:{kind:"part",id:archivePart,property:"x"},keys:[
  {frame:0,value:0,easing:{x1:0.3,y1:0.1,x2:0.7,y2:0.9}},
  {frame:4,value:3,easing:linearEase},
]}];

export async function projectArchiveFixture(id=crypto.randomUUID()) {
  const base=createBlankRig(projectArtboard);
  const atlas=await planSpriteAtlas(base,await exportedAtlasFixture(),{id,name:"Lantern",resizeArtboard:false,preflight:false});
  const first=atlas.state.drawings!.layers[0].tracks[0];
  const linked=first.keys[0].celId!;
  const [state]=editRig(atlas.state,[...archiveCommands,
    {type:"exposure.set",drawingId:atlas.drawingId,clipId:first.clipId,key:{frame:102,celId:linked}},
  ]);
  const clips=atlas.summary.clips.map(({id,frameCount,fps,direction},index)=>({
    id,name:`Lantern ${direction}`,frameCount,fps,trackRevision:index,tracks:archiveTracks,
  }));
  return {id:crypto.randomUUID(),name:"Portable animation",revision:7,state,clips};
}
