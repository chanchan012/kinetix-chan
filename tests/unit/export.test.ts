import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { z } from "zod";
import { compileLottie } from "../../lib/export/lottie";
import { renderPngSequence, renderSpritesheet, renderVideo } from "../../lib/export/raster";
import { createRigState } from "../../lib/rig/model";
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
