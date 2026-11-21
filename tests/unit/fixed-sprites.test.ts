import { expect,it } from "vitest";
import { strFromU8,strToU8,unzipSync,zipSync } from "fflate";
import { fixedSpriteBundleRequest } from "../../lib/export/sprite-bundle-options";
import { fixedSpritePixels,openFixedSpriteBundle } from "../../lib/export/fixed-sprite-manifest";
import { planFixedSpriteTiming } from "../../lib/export/fixed-sprite-timing";
import { prepareFixedSpriteBundle } from "../../lib/export/fixed-sprites";
import { atlasProject,spriteExampleClips,spriteExampleQueue } from "../../lib/export/sprite-example";

const common={revision:7,clips:spriteExampleClips,maxTextureSize:64};

it("materializes the same held pixels, blank poses and ping-pong period in grid sheets and numbered PNGs",async()=>{
  const load=async(layout:"loose"|"fixed-grid")=>{
    const request=fixedSpriteBundleRequest.parse({...common,layout,fps:24});
    const result=await prepareFixedSpriteBundle(spriteExampleQueue,"owner",atlasProject,request);
    if (!result.bytes) throw new Error("Fixed sprite example failed to export.");
    const archive=await openFixedSpriteBundle(result.bytes);
    const preview=await prepareFixedSpriteBundle(spriteExampleQueue,"owner",atlasProject,{...request,preflight:true});
    expect(preview.manifest?.clips).toEqual(archive.manifest.clips);
    expect(preview.bytes).toBeUndefined();
    return archive;
  };
  const grid=await load("fixed-grid"),numbered=await load("loose");
  const [east,west]=grid.manifest.clips;
  expect(east).toMatchObject({totalFrames:214,maxBoundaryErrorMs:0,cues:[{name:"ignite",sourceTick:60,outputFrame:120}]});
  expect(east.runs.map(run=>run.frameCount)).toEqual([200,8,6]);
  expect(west.runs.map(run=>[run.frameId.slice(-1),run.frameCount])).toEqual([["0",9],["1",6],["2",3],["1",6]]);
  expect(grid.manifest.files.filter(file=>file.clipId===east.id).length).toBeGreaterThan(1);
  for (const clip of [east,west]) {
    for (let index=0;index<clip.totalFrames;index++) {
      expect(fixedSpritePixels(grid,clip.id,index)).toEqual(fixedSpritePixels(numbered,clip.id,index));
    }
  }
  expect(fixedSpritePixels(grid,east.id,199).some(value=>!!value)).toBe(true);
  expect(fixedSpritePixels(grid,east.id,200).every(value=>!value)).toBe(true);
  expect(fixedSpritePixels(grid,east.id,207).every(value=>!value)).toBe(true);
  expect(fixedSpritePixels(grid,east.id,208).some(value=>!!value)).toBe(true);
});

it("reports quantization and lost visits while still emitting an image for a sub-frame clip",async()=>{
  const request=fixedSpriteBundleRequest.parse({...common,layout:"loose",fps:5});
  const result=await prepareFixedSpriteBundle(spriteExampleQueue,"owner",atlasProject,{...request,preflight:true});
  const [east,west]=result.manifest!.clips;
  expect(east.runs.map(run=>run.outputStart)).toEqual([0,42,43]);
  expect(east.totalFrames).toBe(45);
  expect(east.durationErrorMs).toBeCloseTo(83.333333);
  expect(west.runs.map(run=>run.frameCount)).toEqual([2,1,1,1]);
  const short={...east,ticksPerSecond:120,durationTicks:3,frames:east.frames.map((frame,index)=>({
    ...frame,startTick:index,durationTicks:1,events:[],
  }))};
  const extreme=planFixedSpriteTiming(short,1);
  expect(extreme.runs.map(run=>run.frameCount)).toEqual([1,0,0]);
  expect(extreme.droppedVisits).toBe(2);
  expect(extreme.durationErrorMs).toBe(975);
  expect((await prepareFixedSpriteBundle(spriteExampleQueue,"owner",atlasProject,{...request,fps:120})).error).toBe("too_many_fixed_frames");
});

it("rejects damaged images, mismatched frame maps and non-profile files",async()=>{
  const request=fixedSpriteBundleRequest.parse({...common,layout:"fixed-grid",fps:12});
  const result=await prepareFixedSpriteBundle(spriteExampleQueue,"owner",atlasProject,request);
  if (!result.bytes) throw new Error("Fixture did not export.");
  const entries=unzipSync(result.bytes);
  const manifest=JSON.parse(strFromU8(entries["timing.json"]));
  const first=manifest.files[0].file;
  const changed=Uint8Array.from(entries[first]);
  changed[30]^=255;
  await expect(openFixedSpriteBundle(zipSync({...entries,[first]:changed}))).rejects.toThrow("checksum");
  await expect(openFixedSpriteBundle(zipSync({...entries,"other.txt":strToU8("other")}))).rejects.toThrow("Unexpected file");
  manifest.clips[0].runs[0].frameCount--;
  await expect(openFixedSpriteBundle(zipSync({...entries,"timing.json":strToU8(JSON.stringify(manifest))}))).rejects.toThrow("timing map");
});
