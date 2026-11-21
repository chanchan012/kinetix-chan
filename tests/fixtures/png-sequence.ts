import { renderPngSequence } from "../../lib/export/raster";
import { editRig } from "../../lib/rig/commands";
import { createBlankRig } from "../../lib/rig/model";

export const sequenceArtboard={name:"Firefly",width:32,height:24,background:null};
export const sourceClipId="fb279836-ec61-46f7-8ea9-7955cfb3ea5f";
export const sequenceTiming={fps:18,frameCount:10,startFrame:3,endFrame:9};

export function exportedSequenceFixture() {
  const drawingId="firefly";
  const [rig]=editRig(createBlankRig(sequenceArtboard),[
    {type:"drawing.create",drawing:{id:drawingId,name:"Firefly",width:32,height:24,storage:{mode:"rgba"}}},
    {type:"cel.create",drawingId,id:"amber"},
    {type:"cel.replace",drawingId,id:"amber",runs:[[7,8,3,0xff8000ff],[8,9,1,0x8040ff80]]},
    {type:"cel.create",drawingId,id:"blue"},
    {type:"cel.replace",drawingId,id:"blue",runs:[[11,16,2,0x00c0ffff]]},
    {type:"exposure.set",drawingId,clipId:sourceClipId,key:{frame:3,celId:"amber"}},
    {type:"exposure.set",drawingId,clipId:sourceClipId,key:{frame:5,celId:null}},
    {type:"exposure.set",drawingId,clipId:sourceClipId,key:{frame:6,celId:"blue"}},
    {type:"exposure.set",drawingId,clipId:sourceClipId,key:{frame:9,celId:"amber"}},
  ]);
  return renderPngSequence({rig,name:"Firefly",tracks:[],clipId:sourceClipId,...sequenceTiming});
}
