import { createHash } from "node:crypto";
import { strFromU8,strToU8,unzipSync,zipSync } from "fflate";
import { expect,it } from "vitest";
import { readProjectArchive,planProjectReopen,writeProjectArchive } from "../../lib/project/archive";
import { renderPngFrame } from "../../lib/export/raster";
import { editRig } from "../../lib/rig/commands";
import { createRigState } from "../../lib/rig/model";
import { archivePart,projectArchiveFixture } from "../fixtures/project-archive";

it("reopens editable facets, linked and blank cels, animated poses and imported companions",async()=>{
  const source=await projectArchiveFixture();
  const {bytes,summary}=writeProjectArchive(source);
  expect(writeProjectArchive(source).bytes).toEqual(bytes);
  expect(summary).toMatchObject({parts:1,drawings:1,clips:[{frameCount:107},{frameCount:6}],warnings:[]});
  const archive=readProjectArchive(bytes);
  const importId=crypto.randomUUID();
  const target=planProjectReopen(archive,"recipient",importId,bytes,"Reopened");
  expect(target.id).not.toBe(source.id);
  expect(planProjectReopen(archive,"recipient",importId,bytes,"Reopened")).toEqual(target);
  expect(planProjectReopen(archive,"another-owner",importId,bytes,"Reopened").id).not.toBe(target.id);
  const [first,second]=target.clips;
  expect(first).toMatchObject({id:target.clipIds[source.clips[0].id],trackRevision:0,tracks:source.clips[0].tracks});
  expect(second.id).not.toBe(source.clips[1].id);
  expect(target.state.spriteSources?.[0]).toMatchObject({clipId:first.id,direction:"east",frames:[expect.objectContaining({events:[{name:"ignite",tick:60,data:{flammable:true}}]}),expect.any(Object),expect.any(Object)]});
  expect(target.state.drawings?.layers[0].tracks[0].keys.map(key=>key.celId)).toEqual([
    source.state.drawings!.layers[0].cels[0].id,null,source.state.drawings!.layers[0].cels[0].id,source.state.drawings!.layers[0].cels[1].id,
  ]);
  function render(state:typeof source.state,clip:typeof first,frame:number) {
    return renderPngFrame({rig:state,name:clip.name,clipId:clip.id,frameCount:clip.frameCount,fps:clip.fps,tracks:clip.tracks,startFrame:frame,endFrame:frame});
  }
  for (const frame of [0,3,100,102,104]) expect(render(target.state,first,frame)).toEqual(render(source.state,source.clips[0],frame));
  const [edited]=editRig(target.state,[{type:"facet.paint",id:archivePart,faceId:"kite-face",fill:"#ff4400"}]);
  expect(render(edited,first,3)).not.toEqual(render(target.state,first,3));
});

it("rejects altered content and unresolved references even when a replacement digest matches",async()=>{
  const source=await projectArchiveFixture();
  const files=unzipSync(writeProjectArchive(source).bytes);
  const state={...source.state,spriteSources:[{...source.state.spriteSources![0],clipId:crypto.randomUUID()}]};
  files["document.json"]=strToU8(JSON.stringify(state));
  expect(()=>readProjectArchive(zipSync(files))).toThrow("integrity check");
  const manifest=JSON.parse(strFromU8(files["manifest.json"]));
  manifest.files["document.json"]={bytes:files["document.json"].length,sha256:createHash("sha256").update(files["document.json"]).digest("hex")};
  files["manifest.json"]=strToU8(JSON.stringify(manifest));
  expect(()=>readProjectArchive(zipSync(files))).toThrow("unresolved");
  expect(()=>readProjectArchive(zipSync({...files,"unexpected.txt":strToU8("extra")}))).toThrow("unexpected");
});

it("reports references to deleted clips and carries legacy study dependencies across a reopen",async()=>{
  const source=await projectArchiveFixture();
  const partial=writeProjectArchive({...source,clips:source.clips.slice(1)});
  expect(partial.manifest.omissions).toEqual({orphanChannels:0,orphanExposureTracks:1,orphanSpriteSources:1});
  expect(readProjectArchive(partial.bytes).state.spriteSources?.map(item=>item.clipId)).toEqual([source.clips[1].id]);
  const legacy=writeProjectArchive({...source,state:createRigState("heron"),clips:[]});
  expect(legacy.manifest.dependencies).toEqual({study:"heron"});
  expect(readProjectArchive(legacy.bytes).state).toEqual(createRigState("heron"));
});
