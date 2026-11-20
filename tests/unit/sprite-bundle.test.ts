import { strFromU8, unzipSync, zipSync } from "fflate";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { prepareSpriteBundle } from "../../lib/export/sprite-bundle";
import { spriteBundleRequest } from "../../lib/export/sprite-bundle-options";
import { frameAtTick, openSpriteBundle, readSpritePng, restoreSpritePixels, spriteDrawOrigin } from "../../lib/export/sprite-playback";
import { editRig } from "../../lib/rig/commands";
import { createBlankRig } from "../../lib/rig/model";

const east="4cf5517c-7086-4638-8c22-769914127c2e";
const west="756cd152-6260-4fe1-94f3-960befb994c2";
const project="4ceac106-8b94-400c-a30b-b3d78b50694d";
const base="art";
const [rig]=editRig(createBlankRig({name:"Test",width:16,height:16,background:null}),[
  {type:"drawing.create",drawing:{id:base,name:"Pink flame",width:16,height:16,
    storage:{mode:"indexed",colors:["#ff0040","#288dcf"]}}},
  {type:"cel.create",drawingId:base,id:"tall"},
  {type:"cel.replace",drawingId:base,id:"tall",runs:[[2,5,1,255],[3,5,1,255],[4,5,2,255],[5,6,1,255]]},
  {type:"cel.create",drawingId:base,id:"wide"},
  {type:"cel.replace",drawingId:base,id:"wide",runs:[[7,9,4,511]]},
  {type:"exposure.set",drawingId:base,clipId:east,key:{frame:0,celId:"tall"}},
  {type:"exposure.set",drawingId:base,clipId:east,key:{frame:1,celId:null}},
  {type:"exposure.set",drawingId:base,clipId:east,key:{frame:2,celId:"wide"}},
  {type:"exposure.set",drawingId:base,clipId:west,key:{frame:0,celId:"wide"}},
  {type:"exposure.set",drawingId:base,clipId:west,key:{frame:1,celId:"tall"}},
  {type:"exposure.set",drawingId:base,clipId:west,key:{frame:2,celId:null}},
]);
const queue={inputs:async(_owner:string,_rig:string,clipId?:string)=>({
  rigId:project,name:"Project",state:rig,revision:7,clip:clipId && {
    id:clipId,name:clipId===east?"Flicker East":"Flicker West",fps:12,frameCount:3,trackRevision:2,tracks:[],
  } || null,
})};
const spec={
  revision:7,filter:"linear",maxTextureSize:16,
  clips:[
    {id:east,trackRevision:2,startFrame:0,endFrame:2,direction:"east",pivot:{x:6,y:10},frames:[
      {frame:0,durationTicks:2,origin:{x:5,y:9},sockets:[{name:"glow",x:6,y:5,angle:0.5}],
        collisions:[{name:"hot",kind:"rect",x:4,y:2,width:3,height:4},{name:"flame",kind:"polygon",
          points:[{x:5,y:2},{x:7,y:6},{x:4,y:6}]}],events:[{name:"ignite",tick:1,data:{flammable:true}}]},
      {frame:1,durationTicks:4},{frame:2,durationTicks:3},
    ]},
    {id:west,trackRevision:2,startFrame:0,endFrame:2,direction:"west",loopMode:"ping-pong",
      frames:[{frame:0,durationTicks:3},{frame:1,durationTicks:2},{frame:2,durationTicks:1}]},
  ],
};

describe("portable multi-clip sprite bundles",()=>{
  it("preserves samples, anchors, events and unequal holds across all layouts",async ()=>{
    const results=[];
    for (const layout of ["loose","fixed-grid","packed"] as const) {
      const request=spriteBundleRequest.parse({...spec,layout,...(layout==="packed" && {
        packing:{padding:1,extrusion:1,rotate:true},
      })});
      const plan=await prepareSpriteBundle(queue,"owner",project,{...request,preflight:true});
      const result=await prepareSpriteBundle(queue,"owner",project,request);
      if (!result.bytes || !plan.manifest) throw new Error("The multi-clip fixture failed.");
      expect(result.manifest.clips).toEqual(plan.manifest.clips);
      expect(result.manifest.files.map(({file,width,height})=>({file,width,height}))).toEqual(plan.manifest.files);
      const {manifest,textures}=await openSpriteBundle(result.bytes);
      const first=manifest.clips[0].frames[0];
      expect(manifest.clips.map(clip=>[clip.name,clip.direction,clip.durationTicks])).toEqual([
        ["Flicker East","east",9],["Flicker West","west",6],
      ]);
      expect(first).toMatchObject({
        origin:{x:5,y:9},pivot:{x:6,y:10},sockets:[{name:"glow",x:6,y:5,angle:0.5}],
        collisions:[{name:"hot",width:3,height:4},{name:"flame",points:[{x:5,y:2},{x:7,y:6},{x:4,y:6}]}],
        events:[{name:"ignite",tick:1,data:{flammable:true}}],
      });
      expect([0,1,2,5,6,8,9].map(tick=>frameAtTick(manifest.clips[0],tick).sourceFrame)).toEqual([0,0,1,1,2,2,0]);
      expect(Array.from({length:10},(_,tick)=>frameAtTick(manifest.clips[1],tick).sourceFrame)).toEqual([0,0,0,1,1,2,1,1,0,0]);
      for (const clip of manifest.clips) {
        const restored=clip.frames.map(frame=>{
          const cropped=restoreSpritePixels(textures.get(frame.file)!,frame,manifest.texture);
          const full=new Uint8ClampedArray(16*16*4);
          for (let y=0;y<cropped.height;y++) {
            const target=((frame.trimOffset.y+y)*16+frame.trimOffset.x)*4;
            full.set(cropped.pixels.subarray(y*cropped.width*4,(y+1)*cropped.width*4),target);
          }
          return full;
        });
        results.push(restored);
      }
      expect(first.rotation).toBe(layout==="packed"?90:0);
      expect(spriteDrawOrigin(first,40,50,1.25)).toEqual(layout==="packed"?{x:38.75,y:40}:{x:32.5,y:37.5});
      if (layout==="packed") {
        const page=textures.get(first.file)!;
        const at=(x:number,y:number)=>Array.from(page.rgba.slice((y*page.width+x)*4,(y*page.width+x)*4+4));
        const {x,y}=first.rect;
        expect(at(x-1,y+1)).toEqual(at(x,y+1));
        expect(at(x-1,y+1)).toEqual([255,0,64,255]);
        expect(at(x-2,y+1)).toEqual([0,0,0,0]);
        expect(manifest.clips[0].frames[1]).toMatchObject({blank:true,rect:{width:1,height:1}});
        expect(manifest.clips[1].frames[1]).toMatchObject({file:first.file,rect:first.rect});
      } else expect(manifest.files).toHaveLength(6);
      const independent=await loadImage(unzipSync(result.bytes)[first.file]);
      expect([independent.width,independent.height]).toEqual([textures.get(first.file)!.width,textures.get(first.file)!.height]);
    }
    expect(results[0]).toEqual(results[2]);
    expect(results[0]).toEqual(results[4]);
    expect(results[1]).toEqual(results[3]);
    expect(results[1]).toEqual(results[5]);
    expect(results[0][1].every(value=>!value)).toBe(true);
  });

  it("enforces revision pins, texture size, cue bounds and checksums",async ()=>{
    const request=spriteBundleRequest.parse({...spec,layout:"loose"});
    const stale=await prepareSpriteBundle(queue,"owner",project,{...request,revision:6});
    expect(stale).toMatchObject({error:"revision_conflict",status:409});
    const missing=await prepareSpriteBundle({inputs:async()=>undefined},"unauthorized",project,request);
    expect(missing).toMatchObject({error:"not_found",status:404});
    const tooLarge=await prepareSpriteBundle(queue,"owner",project,{...request,scale:3});
    expect(tooLarge).toMatchObject({error:"frame_exceeds_texture_size"});
    expect(spriteBundleRequest.safeParse({...spec,layout:"loose",clips:[{
      ...spec.clips[0],frames:[{frame:0,durationTicks:2,events:[{name:"late",tick:2}]}],
    }]}).success).toBe(false);
    const result=await prepareSpriteBundle(queue,"owner",project,request);
    if (!result.bytes) throw new Error("The fixture did not export.");
    const entries=unzipSync(result.bytes);
    const manifest=JSON.parse(strFromU8(entries["kinetix.json"]));
    const name=manifest.files[0].file as string;
    entries[name][30]^=255;
    await expect(openSpriteBundle(zipSync(entries,{level:0}))).rejects.toThrow("checksum");
  });

  it("writes actual linear premultiplied channel values",async ()=>{
    const [soft]=editRig(rig,[{type:"drawing.palette",id:base,colors:["#8080ff","#288dcf"]},
      {type:"cel.replace",drawingId:base,id:"tall",runs:[[4,5,1,128]]}]);
    const request=spriteBundleRequest.parse({...spec,layout:"loose",colorSpace:"linear",alpha:"premultiplied"});
    const result=await prepareSpriteBundle({inputs:async(...args)=>({...await queue.inputs(...args),state:soft})},"owner",project,request);
    if (!result.bytes) throw new Error("The fixture did not export.");
    const files=unzipSync(result.bytes);
    const png=files["frames/00001.png"];
    expect(Buffer.from(png).indexOf("gAMA")).toBeGreaterThan(0);
    const {rgba}=readSpritePng(png,{width:16,height:16});
    const index=(4*16+5)*4;
    expect(Array.from(rgba.slice(index,index+4))).toEqual([28,28,128,128]);
    const {manifest,textures}=await openSpriteBundle(result.bytes);
    const frame=manifest.clips[0].frames[0];
    const restored=restoreSpritePixels(textures.get(frame.file)!,frame,manifest.texture);
    expect(Array.from(restored.pixels.slice(index,index+4))).toEqual([129,129,255,128]);
    const original=await loadImage(png);
    expect(createCanvas(original.width,original.height).width).toBe(16);
  });

  it("bakes every pose into separate packed pages under a small texture limit",async ()=>{
    const clipId=east;
    const poses=[0,2,5,8,12,14];
    const [six]=editRig(rig,[
      ...poses.flatMap((frame,index):Parameters<typeof editRig>[1]=>{
        const id="larger-"+index;
        return [
          {type:"cel.create",drawingId:base,id},
          {type:"cel.replace",drawingId:base,id,runs:[
            [2,2+index,6,255],[3,2+index,index+1,255],[4,2+index,2,255],[5,2+index,2,255],[6,2+index,3,255],
          ]},
          {type:"exposure.set",drawingId:base,clipId,key:{frame,celId:id}},
        ];
      }),
      {type:"exposure.remove",drawingId:base,clipId,frame:1},
      {type:"exposure.set",drawingId:base,clipId,key:{frame:11,celId:null}},
    ]);
    const source={inputs:async(...args:Parameters<typeof queue.inputs>)=>{
      const row=await queue.inputs(...args);
      return {...row,state:six,clip:row.clip && {...row.clip,frameCount:16}};
    }};
    for (const [scale,limit] of [[1,16],[3,48]]) {
      const rendered=await prepareSpriteBundle(source,"owner",project,spriteBundleRequest.parse({
        revision:7,layout:"packed",scale,maxTextureSize:limit,packing:{padding:1,extrusion:1,rotate:true},
        clips:[{id:clipId,trackRevision:2,startFrame:0,endFrame:15,pivot:{x:8,y:9}}],
      }));
      if (!rendered.bytes) throw new Error("The six-pose fixture failed.");
      const {manifest,textures}=await openSpriteBundle(rendered.bytes);
      expect(manifest.files.length).toBeGreaterThan(1);
      expect(manifest.files.every(page=>page.width<=limit && page.height<=limit)).toBe(true);
      const clip=manifest.clips[0];
      const expected=[0,0,1,1,1,2,2,2,3,3,3,-1,4,4,5,5];
      for (const [tick,pose] of expected.entries()) {
        const frame=frameAtTick(clip,tick);
        expect(frame.pivot).toEqual({x:8*scale,y:9*scale});
        expect(frame.blank).toBe(pose===-1);
        if (pose>=0) {
          expect(frame.trimOffset).toEqual({x:(2+pose)*scale,y:2*scale});
          const image=restoreSpritePixels(textures.get(frame.file)!,frame,manifest.texture);
          expect([image.width,image.height]).toEqual([6*scale,5*scale]);
          expect(Array.from(image.pixels.slice(0,4))).toEqual([255,0,64,255]);
        }
      }
    }
  });
});
