import { unzipSync,zipSync } from "fflate";
import { expect,it } from "vitest";
import { prepareSpriteBundle } from "../../lib/export/sprite-bundle";
import { spriteBundleRequest } from "../../lib/export/sprite-bundle-options";
import { openSpriteBundle } from "../../lib/export/sprite-playback";
import { planSpriteAtlas } from "../../lib/import/sprite-atlas";
import { editRig } from "../../lib/rig/commands";
import { createBlankRig } from "../../lib/rig/model";
import { spritePlaybackFrame } from "../../lib/rig/sprite-sources";
import { atlasProject,decodedAtlas,exportedAtlasFixture } from "../fixtures/sprite-atlas";

const blank=createBlankRig({name:"Import",width:16,height:16,background:null});
const options={id:"d1e87a72-23c1-41b1-b641-44a87426165b",name:"Imported",resizeArtboard:true,preflight:true};

async function reexport(plan:Awaited<ReturnType<typeof planSpriteAtlas>>,state=plan.state,range?:{startFrame:number;endFrame:number}) {
  const clips=range ? plan.summary.clips.slice(0,1) : plan.summary.clips;
  const request=spriteBundleRequest.parse({revision:1,layout:"loose",clips:clips.map(clip=>({
    id:clip.id,trackRevision:0,startFrame:0,endFrame:clip.frameCount-1,...range,preserveImportedTiming:true,
  }))});
  const result=await prepareSpriteBundle({inputs:async(_owner,_rig,id)=>({rigId:atlasProject,name:"Fixture",state,revision:1,
    clip:clips.find(clip=>clip.id===id) ?? null,
  })},"owner",atlasProject,request);
  if (!result.bytes) throw new Error(`Cannot re-export fixture: ${result.error}`);
  return decodedAtlas(result.bytes);
}

it("restores all three sprite layouts as editable cels and preserves long holds and engine companions",async()=>{
  for (const layout of ["packed","loose","fixed-grid"] as const) {
    const bytes=await exportedAtlasFixture(layout,layout==="packed" ? 2 : 1);
    const archive=await openSpriteBundle(bytes);
    if (layout==="packed") expect(archive.manifest.clips[0].frames[0].rotation).toBe(90);
    const plan=await planSpriteAtlas(blank,bytes,options);
    expect(plan.summary).toMatchObject({layout,celCount:4,blankFrames:2,companion:{pivots:6,sockets:1,collisions:1,events:1}});
    expect(plan.state.drawings!.layers[0].tracks[0].keys.map(key=>[key.frame,Boolean(key.celId)])).toEqual([[0,true],[100,false],[104,true]]);
    expect(plan.previewPng).toBeTruthy();
    expect(await reexport(plan)).toEqual(await decodedAtlas(bytes));
    expect(plan.summary.clips.map(clip=>clip.id)).toEqual((await planSpriteAtlas(blank,bytes,{...options,preflight:false})).summary.clips.map(clip=>clip.id));
    const [east,west]=plan.state.spriteSources!;
    expect(spritePlaybackFrame(east,200,107)).toBe(106);
    expect(Array.from({length:9},(_,tick)=>spritePlaybackFrame(west,tick,6))).toEqual([0,1,2,3,4,5,4,3,0]);
  }
});

it("splits an edited hold and rebases the cue to the exported sample and range",async()=>{
  const plan=await planSpriteAtlas(blank,await exportedAtlasFixture(),options);
  const drawingId=plan.drawingId;
  const clipId=plan.summary.clips[0].id;
  const [edited]=editRig(plan.state,[
    {type:"cel.create",drawingId,id:"new-drawing"},
    {type:"cel.replace",drawingId,id:"new-drawing",runs:[[3,5,2,0x44dd77ff]]},
    {type:"exposure.set",drawingId,clipId,key:{frame:50,celId:"new-drawing"}},
  ]);
  const result=await reexport(plan,edited,{startFrame:25,endFrame:85});
  const [clip]=result.clips;
  expect(clip.durationTicks).toBe(61);
  expect(clip.frames).toMatchObject([
    {startTick:0,durationTicks:25,pivot:{x:6,y:10},events:[]},
    {startTick:25,durationTicks:36,pivot:{x:6,y:10},events:[{name:"ignite",tick:10}]},
  ]);
  expect(Array.from(clip.frames[1].rgba.slice((3*16+5)*4,(3*16+5)*4+4))).toEqual([0x44,0xdd,0x77,0xff]);
});

it("rejects damaged textures before creating any editable state",async()=>{
  const files=unzipSync(await exportedAtlasFixture());
  const texture=Object.keys(files).find(file=>file.endsWith(".png"))!;
  files[texture][40]^=1;
  await expect(planSpriteAtlas(blank,zipSync(files),options)).rejects.toThrow("checksum");
  expect(blank.drawings).toBeUndefined();
});
