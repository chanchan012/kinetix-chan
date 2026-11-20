import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { z } from "zod";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { compileLottie } from "../../lib/export/lottie";
import { renderPngFrame, renderPngSequence, renderSpritesheet, renderVideo } from "../../lib/export/raster";
import { createBlankRig, createRigState, readRigState } from "../../lib/rig/model";
import { editRig } from "../../lib/rig/commands";
import { partSpace, partWorldSpace } from "../../lib/rig/part-transform";
import { bindMesh, deformMesh } from "../../lib/rig/skinning";
import { evaluateRig } from "../../lib/rig/kinematics";
import { setKey } from "../../lib/rig/animation";
import type { ExportSnapshot } from "../../lib/export/frames";

function snapshot(): ExportSnapshot {
  const channel = { kind:"bone", id:"root", property:"rotation" } as const;
  return {
    rig:createRigState("fox"), name:"Cycle", fps:24, frameCount:32, startFrame:0, endFrame:3,
    tracks:setKey(setKey([],channel,0,0),channel,3,0.5),
  };
}

const vec = z.tuple([z.number(), z.number()]);
const shape = z.object({ i: z.array(vec), o: z.array(vec), v: z.array(vec).min(2), c: z.boolean() })
  .refine(path => path.i.length === path.v.length && path.o.length === path.v.length);
const shapeProperty = z.discriminatedUnion("a", [
  z.object({ a:z.literal(0), k:shape }),
  z.object({ a:z.literal(1), k:z.array(z.object({ t:z.int().min(0), s:z.tuple([shape]), h:z.literal(1) })).min(2) }),
]);
const lottie = z.object({
  v:z.literal("5.12.2"), fr:z.number().positive(), ip:z.literal(0), op:z.int().positive(),
  w:z.int().positive(), h:z.int().positive(), assets:z.array(z.unknown()),
  layers:z.array(z.object({
    ty:z.literal(4), ind:z.int().positive(), ks:z.object({ o:z.object({ a:z.literal(0), k:z.literal(100) }) }),
    shapes:z.tuple([
      z.object({ ty:z.literal("sh"), ks:shapeProperty }),
      z.object({ ty:z.enum(["fl","st"]), c:z.object({ a:z.literal(0), k:z.tuple([z.number(),z.number(),z.number()]) }) }),
    ]),
  })).min(1),
});

describe("animation export formats", () => {
  it("uses one path transform for editing, mesh deformation and export", async () => {
    const input = {...snapshot(),rig:createBlankRig({name:"Logo",width:96,height:96,background:null}),
      frameCount:1,endFrame:0,tracks:[]};
    const part = {
      id:"mark",name:"Mark",parentId:null,offset:{x:40,y:20},rotation:Math.PI/2,scale:{x:2,y:1},
      closed:true,fill:"#ff5500",knots:[{point:{x:10,y:10}},{point:{x:22,y:10}},{point:{x:22,y:22}},{point:{x:10,y:22}}],
    };
    const [rig] = editRig(input.rig,[
      {type:"part.create",part}, {type:"part.pivot",id:"mark",pivot:{x:16,y:16}},
    ]);
    input.rig = rig;
    const transformed = rig.parts[0];
    const poses = evaluateRig(rig);
    const world = partWorldSpace({x:10,y:10},transformed,poses);
    expect(world.x).toBeCloseTo(30);
    expect(world.y).toBeCloseTo(40);
    expect(partSpace(world,transformed,poses).x).toBeCloseTo(10);
    expect(partSpace(world,transformed,poses).y).toBeCloseTo(10);

    const image = await loadImage(renderPngFrame(input));
    const ctx = createCanvas(96,96).getContext("2d");
    ctx.drawImage(image,0,0);
    expect(Array.from(ctx.getImageData(24,50,1,1).data)).toEqual([255,85,0,255]);
    expect(ctx.getImageData(44,44,1,1).data[3]).toBe(0);
    expect(lottie.parse(compileLottie(input)).layers[0].shapes[0].ks).toMatchObject({
      k:{v:[[30,40],[30,64],[18,64],[18,40],[30,40]]},
    });

    const withBone = {...rig,bones:[{id:"root",name:"Root",offset:{x:0,y:0},length:1,rotation:0,parentId:null}]};
    const bonePoses = evaluateRig(withBone);
    const bound = {...transformed,mesh:bindMesh(transformed,bonePoses,"root")};
    const deformed = deformMesh(bound,bonePoses);
    expect(deformed[0].x).toBeCloseTo(world.x);
    expect(deformed[0].y).toBeCloseTo(world.y);
  });

  it("preserves blank artboard dimensions, transparency, geometry and stacking across export formats", async () => {
    const artboard = { name:"Portrait", width:96, height:151, background:null };
    const triangle = {
      id:"base", name:"Head", parentId:null, offset:{x:0,y:0}, closed:true, fill:"#ff1100",
      knots:[{point:{x:16,y:16}},{point:{x:72,y:16}},{point:{x:44,y:90}}],
    };
    const blank = createBlankRig(artboard);
    const [rig] = editRig(blank,[
      {type:"part.create",part:triangle},
      {type:"part.create",part:{...triangle,id:"top",fill:"#0055ff"}},
      {type:"part.reorder",id:"base",direction:"forward"},
      {type:"part.splitEdge",id:"base",edge:0},
    ]);
    expect(rig.parts[1].knots[1].point).toEqual({x:44,y:16});
    expect(readRigState(JSON.parse(JSON.stringify(rig)))).toEqual(rig);
    const input = {...snapshot(),rig,frameCount:1,endFrame:0,tracks:[]};
    const image = await loadImage(renderPngFrame(input));
    const ctx = createCanvas(image.width,image.height).getContext("2d");
    ctx.drawImage(image,0,0);
    expect([image.width,image.height]).toEqual([96,151]);
    expect(ctx.getImageData(1,1,1,1).data[3]).toBe(0);
    expect(Array.from(ctx.getImageData(44,24,1,1).data)).toEqual([255,17,0,255]);
    expect(compileLottie(input)).toMatchObject({w:96,h:151,op:1});
    expect(compileLottie(snapshot())).toMatchObject({w:512,h:320});
  });

  it("renders keyed artwork position on a design without a skeleton", async () => {
    const rig = createBlankRig({name:"Sprite",width:64,height:64,background:null});
    rig.parts.push({
      id:"sprite",name:"Sprite",parentId:null,offset:{x:0,y:0},closed:true,fill:"#ff0000",
      knots:[{point:{x:4,y:4}},{point:{x:16,y:4}},{point:{x:16,y:16}},{point:{x:4,y:16}}],
    });
    const channel = {kind:"part",id:"sprite",property:"x"} as const;
    const tracks = setKey(setKey(setKey([],channel,0,0),channel,2,32),channel,4,0);
    const input = {...snapshot(),rig,frameCount:5,startFrame:1,endFrame:1,tracks};
    const image = await loadImage(renderPngFrame(input));
    const ctx = createCanvas(64,64).getContext("2d");
    ctx.drawImage(image,0,0);
    expect(ctx.getImageData(8,8,1,1).data[3]).toBe(0);
    expect(Array.from(ctx.getImageData(24,8,1,1).data)).toEqual([255,0,0,255]);
    expect(lottie.parse(compileLottie(input)).layers[0].shapes[0].ks).toMatchObject({
      a:0,k:{v:[[20,4],[32,4],[32,16],[20,16],[20,4]]},
    });
    expect(rig.parts[0].offset.x).toBe(0);
  });

  it("produces deterministic Lottie shape layers and animated control points", () => {
    const input = snapshot();
    input.rig.parts.push({
      id:"curve",name:"Curve",parentId:"root",offset:{x:0,y:0},closed:false,fill:"#cc5511",
      knots:[{ point:{x:1,y:1},outgoing:{x:30,y:8} },{ point:{x:20,y:40},incoming:{x:15,y:19} }],
    });
    const result = lottie.parse(compileLottie(input));
    expect(result.op).toBe(4);
    const curve = result.layers[0].shapes[0].ks;
    expect(curve.a).toBe(1);
    if (curve.a === 1) expect(curve.k[0].s[0].o[0]).toEqual([29,7]);
    expect(compileLottie(input)).toEqual(compileLottie(input));
  });

  it("renders a valid PNG grid and named frame sequence with timing metadata", () => {
    const png = renderSpritesheet(snapshot());
    expect(png.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
    expect([png.readUInt32BE(16),png.readUInt32BE(20)]).toEqual([1024,640]);
    const archive = unzipSync(renderPngSequence({ ...snapshot(), startFrame:1 }));
    expect(Object.keys(archive)).toEqual(["frames/00002.png","frames/00003.png","frames/00004.png","sequence.json"]);
    expect(JSON.parse(strFromU8(archive["sequence.json"]))).toMatchObject({fps:24,startFrame:2,endFrame:4});
  });

  it("encodes real MP4 and WebM containers", async () => {
    const [mp4,webm] = await Promise.all([renderVideo(snapshot(),"mp4"),renderVideo(snapshot(),"webm")]);
    expect(mp4.toString("ascii",4,8)).toBe("ftyp");
    expect(webm.subarray(0,4)).toEqual(Buffer.from([0x1a,0x45,0xdf,0xa3]));
  }, 20_000);
});
