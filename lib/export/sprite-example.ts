import { editRig } from "../rig/commands";
import { createBlankRig } from "../rig/model";

export const atlasProject="4ceac106-8b94-400c-a30b-b3d78b50694d";
const east="4cf5517c-7086-4638-8c22-769914127c2e";
const west="756cd152-6260-4fe1-94f3-960befb994c2";
const drawingId="flame";
const [rig]=editRig(createBlankRig({name:"Flame",width:16,height:16,background:null}),[
  {type:"drawing.create",drawing:{id:drawingId,name:"Flame",width:16,height:16,storage:{mode:"rgba"}}},
  {type:"cel.create",drawingId,id:"tall"},
  {type:"cel.replace",drawingId,id:"tall",runs:[[2,5,1,0xff0040ff],[3,5,1,0xff0040ff],[4,5,2,0xff0040ff],[5,6,1,0xff0040ff]]},
  {type:"cel.create",drawingId,id:"wide"},
  {type:"cel.replace",drawingId,id:"wide",runs:[[7,9,4,0x0080ff80]]},
  {type:"exposure.set",drawingId,clipId:east,key:{frame:0,celId:"tall"}},
  {type:"exposure.set",drawingId,clipId:east,key:{frame:1,celId:null}},
  {type:"exposure.set",drawingId,clipId:east,key:{frame:2,celId:"wide"}},
  {type:"exposure.set",drawingId,clipId:west,key:{frame:0,celId:"wide"}},
  {type:"exposure.set",drawingId,clipId:west,key:{frame:1,celId:"tall"}},
  {type:"exposure.set",drawingId,clipId:west,key:{frame:2,celId:null}},
]);

export const spriteExampleClips=[
  {id:east,trackRevision:2,startFrame:0,endFrame:2,direction:"east",loopMode:"once",pivot:{x:6,y:10},frames:[
    {frame:0,durationTicks:100,origin:{x:5,y:9},sockets:[{name:"glow",x:6,y:5,angle:0.5}],
      collisions:[{name:"hot",kind:"rect",x:4,y:2,width:3,height:4}],events:[{name:"ignite",tick:60,data:{flammable:true}}]},
    {frame:1,durationTicks:4},{frame:2,durationTicks:3},
  ]},
  {id:west,trackRevision:2,startFrame:0,endFrame:2,direction:"west",loopMode:"ping-pong",
    frames:[{frame:0,durationTicks:3},{frame:1,durationTicks:2},{frame:2,durationTicks:1}]},
];

export const spriteExampleQueue={inputs:async(_owner:string,_project:string,clipId?:string)=>({
  rigId:atlasProject,name:"Flame",state:rig,revision:7,clip:clipId ? {
    id:clipId,name:"Flicker",fps:clipId===east ? 12 : 8,frameCount:3,trackRevision:2,tracks:[],
  } : null,
})};
