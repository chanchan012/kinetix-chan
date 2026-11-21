import { strToU8,strFromU8,unzipSync,zipSync } from "fflate";
import { PNG } from "pngjs";
import { describe,expect,it } from "vitest";
import { planPngSequence } from "../../lib/import/png-sequence";
import { renderPngSequence } from "../../lib/export/raster";
import { editRig } from "../../lib/rig/commands";
import { celAt } from "../../lib/rig/drawings";
import { createBlankRig,readRigState } from "../../lib/rig/model";
import { exportedSequenceFixture,sequenceArtboard } from "../fixtures/png-sequence";

const id="2d3dce49-c298-4471-bc78-2da7ab79d3d0";
const rig=createBlankRig(sequenceArtboard);
const options={id,name:"Firefly",fps:24,resizeArtboard:false,preflight:true};
const path=(frame:number)=>`frames/${String(frame).padStart(5,"0")}.png`;

describe("PNG sequence interchange",()=>{
  it("preserves the source timebase and visible pixels through an editable save and re-export",()=>{
    const archive=exportedSequenceFixture();
    const plan=planPngSequence(rig,archive,options);
    expect(plan.summary).toMatchObject({width:32,height:24,fps:18,timing:"manifest",frameCount:7,sourceStartFrame:4,
      sourceEndFrame:10,celCount:3,exposureCount:4,heldFrames:3,blankFrames:1,runCount:5});
    expect(plan.previewPng).toBeTruthy();
    const saved=readRigState(JSON.parse(JSON.stringify(plan.state)));
    const drawing=saved.drawings!.layers[0];
    const [a,b,c]=drawing.cels;
    expect(a.runs).toEqual(c.runs);
    expect(drawing.tracks).toEqual([{clipId:id,keys:[{frame:0,celId:a.id},{frame:2,celId:null},
      {frame:3,celId:b.id},{frame:6,celId:c.id}]}]);
    expect(celAt(drawing,{clipId:id,frame:1})?.id).toBe(a.id);
    expect(celAt(drawing,{clipId:id,frame:2})).toBeUndefined();
    expect(celAt(drawing,{clipId:"unrelated",frame:0})).toBeUndefined();
    const output=unzipSync(renderPngSequence({rig:saved,name:"Firefly",tracks:[],clipId:id,fps:18,frameCount:7,startFrame:0,endFrame:6}));
    expect(JSON.parse(strFromU8(output["sequence.json"]))).toEqual({width:32,height:24,fps:18,startFrame:1,endFrame:7});
    const original=unzipSync(archive);
    for (let frame=1;frame<=7;frame++) expect(PNG.sync.read(Buffer.from(output[path(frame)])).data)
      .toEqual(PNG.sync.read(Buffer.from(original[path(frame+3)])).data);

    const [edited]=editRig(saved,[{type:"cel.replace",drawingId:drawing.id,id:a.id,runs:[[7,8,3,0x22cc66ff]]}]);
    expect(celAt(edited.drawings!.layers[0],{clipId:id,frame:1})?.runs).toEqual([[7,8,3,0x22cc66ff]]);
    expect(celAt(edited.drawings!.layers[0],{clipId:id,frame:6})?.runs).toEqual(c.runs);
  });

  it("imports numbered loose files in numeric order and can match an empty artboard",()=>{
    const original=unzipSync(exportedSequenceFixture());
    const loose=zipSync({"walk10.png":original[path(7)],"walk9.png":original[path(4)]});
    const smaller=createBlankRig({name:"Small",width:16,height:16,background:null});
    expect(()=>planPngSequence(smaller,loose,options)).toThrow("frames exceed this artboard");
    const plan=planPngSequence(smaller,loose,{...options,fps:30,resizeArtboard:true});
    expect(plan.summary).toMatchObject({timing:"numbered",fps:30,sourceStartFrame:9,sourceEndFrame:10,celCount:2});
    expect(plan.state).toMatchObject({artboard:{width:32,height:24},drawings:{layers:[{cels:[{runs:[[7,8,3,0xff8000ff],[8,9,1,0x8040ff80]]},
      {runs:[[11,16,2,0x00c0ffff]]}]}]}});
    expect(()=>planPngSequence(plan.state,loose,{...options,resizeArtboard:true})).toThrow("empty design");
  });

  it("validates paths, gaps, manifest dimensions and damaged PNG data before building any state",()=>{
    const original=unzipSync(exportedSequenceFixture());
    expect(()=>planPngSequence(rig,zipSync({"../frame1.png":original[path(4)]}),options)).toThrow("invalid paths");
    expect(()=>planPngSequence(rig,zipSync({"walk1.png":original[path(4)],"walk3.png":original[path(7)]}),options)).toThrow("consecutive");
    expect(()=>planPngSequence(rig,zipSync({...original,"sequence.json":strToU8('{"width":24,"height":24,"fps":18,"startFrame":4,"endFrame":10}')}),options))
      .toThrow("match the sequence dimensions");
    const damaged=original[path(4)].slice(0,-5);
    expect(()=>planPngSequence(rig,zipSync({...original,[path(4)]:damaged}),options)).toThrow("Frame 4 could not be imported");
    expect(rig.drawings).toBeUndefined();
  });

  it("builds a full 150-sample import within the shared command limit per batch",()=>{
    const entries:Record<string,Uint8Array>={};
    for (let index=1;index<=150;index++) {
      const image=new PNG({width:32,height:24});
      image.data[2]=index;
      image.data[3]=255;
      entries[`frame${index}.png`]=PNG.sync.write(image);
    }
    const plan=planPngSequence(rig,zipSync(entries),options);
    expect(plan.summary).toMatchObject({frameCount:150,celCount:150,heldFrames:0,runCount:150});
    expect(plan.state.drawings?.layers[0].tracks[0].keys.at(-1)?.frame).toBe(149);
  });
});
