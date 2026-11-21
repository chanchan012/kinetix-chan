import { prepareSpriteBundle } from "../../lib/export/sprite-bundle";
import { spriteBundleRequest,type SpriteBundleRequest } from "../../lib/export/sprite-bundle-options";
import { openSpriteBundle,restoreSpritePixels } from "../../lib/export/sprite-playback";
import { editRig } from "../../lib/rig/commands";
import { createBlankRig } from "../../lib/rig/model";

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

export async function exportedAtlasFixture(layout:SpriteBundleRequest["layout"]="packed",scale=1) {
  const request=spriteBundleRequest.parse({revision:7,layout,scale,maxTextureSize:layout==="packed" ? 16 : 64,
    ...(layout==="packed" && {packing:{padding:1,extrusion:1,rotate:true}}),clips:[
      {id:east,trackRevision:2,startFrame:0,endFrame:2,direction:"east",loopMode:"once",pivot:{x:6,y:10},frames:[
        {frame:0,durationTicks:100,origin:{x:5,y:9},sockets:[{name:"glow",x:6,y:5,angle:0.5}],
          collisions:[{name:"hot",kind:"rect",x:4,y:2,width:3,height:4}],events:[{name:"ignite",tick:60,data:{flammable:true}}]},
        {frame:1,durationTicks:4},{frame:2,durationTicks:3},
      ]},
      {id:west,trackRevision:2,startFrame:0,endFrame:2,direction:"west",loopMode:"ping-pong",
        frames:[{frame:0,durationTicks:3},{frame:1,durationTicks:2},{frame:2,durationTicks:1}]},
    ]});
  const fixture=await prepareSpriteBundle({inputs:async(_owner,_project,clipId)=>({
    rigId:atlasProject,name:"Flame",state:rig,revision:7,clip:clipId ? {
      id:clipId,name:"Flicker",fps:clipId===east ? 12 : 8,frameCount:3,trackRevision:2,tracks:[],
    } : null,
  })},"owner",atlasProject,request);
  if (!fixture.bytes) throw new Error(`Cannot export sprite fixture: ${fixture.error}`);
  return fixture.bytes;
}

export async function decodedAtlas(bytes:Uint8Array) {
  const {manifest,textures}=await openSpriteBundle(bytes);
  return {pixelScale:manifest.source.pixelScale,clips:manifest.clips.map(clip=>({
    name:clip.name,direction:clip.direction,loopMode:clip.loopMode,durationTicks:clip.durationTicks,fps:clip.ticksPerSecond,
    frames:clip.frames.map(frame=>{
      const crop=restoreSpritePixels(textures.get(frame.file)!,frame,manifest.texture);
      const {width,height}=frame.sourceSize;
      const rgba=new Uint8ClampedArray(width*height*4);
      for (let y=0;y<crop.height;y++) {
        rgba.set(crop.pixels.subarray(y*crop.width*4,(y+1)*crop.width*4),((y+frame.trimOffset.y)*width+frame.trimOffset.x)*4);
      }
      const {startTick,durationTicks,pivot,origin,sockets,collisions,events}=frame;
      return {startTick,durationTicks,pivot,origin,sockets,collisions,events,rgba};
    }),
  }))};
}
