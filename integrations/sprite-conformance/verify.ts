import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { PNG } from "pngjs";
import { fixedSpriteLimits,fixedSpritePixels,openFixedSpriteBundle } from "../../lib/export/fixed-sprite-manifest";
import { compileSpriteTimeline,frameAtTick,openSpriteBundle,restoreSpritePixels,spriteDrawOrigin } from "../../lib/export/sprite-playback";

/** Slice one PNG using only row-major cell dimensions supplied by the receiving engine. */
function* plainCells(image:PNG,width:number,height:number) {
  assert.equal(image.width%width+image.height%height,0);
  for (let top=0;top<image.height;top+=height) for (let left=0;left<image.width;left+=width) {
    const cell=new Uint8Array(width*height*4);
    for (let y=0;y<height;y++) {
      const start=((top+y)*image.width+left)*4;
      cell.set(image.data.subarray(start,start+width*4),y*width*4);
    }
    yield cell;
  }
}

async function inspect(filename:string) {
  const bytes=await readFile(filename);
  if (bytes.byteLength>fixedSpriteLimits.bytes) throw new Error("The sprite ZIP exceeds the size limit.");
  const hasSidecar=Object.keys(unzipSync(bytes,{filter:entry=>entry.name==="timing.json" && entry.originalSize<=fixedSpriteLimits.bytes})).length>0;
  const {manifest}=hasSidecar ? await openFixedSpriteBundle(bytes) : await openSpriteBundle(bytes);
  console.log(JSON.stringify(manifest,null,2));
}

async function verify() {
  const [sourceBytes,gridBytes,sequenceBytes,expectedText]=await Promise.all([
    readFile("examples/source-v2.zip"),readFile("examples/grid-24.zip"),readFile("examples/frames-24.zip"),
    readFile("examples/expected.json","utf8"),
  ]);
  const expected=JSON.parse(expectedText) as {
    fps:number;cell:{width:number;height:number};clips:{id:string;direction:string;loopMode:string;
      runs:[number,number][];cues:[string,number,number][]}[];
  };
  const source=await openSpriteBundle(sourceBytes);
  const grid=await openFixedSpriteBundle(gridBytes);
  const sequence=await openFixedSpriteBundle(sequenceBytes);
  assert.equal(grid.manifest.layout,"fixed-grid");
  assert.equal(sequence.manifest.layout,"loose");
  const width=expected.cell.width,height=expected.cell.height;
  assert.equal(grid.manifest.fps,expected.fps);
  assert.deepEqual(grid.manifest.cell,expected.cell);
  assert.deepEqual(grid.manifest.clips,sequence.manifest.clips);

  const first=source.manifest.clips[0].frames[0];
  assert.equal(first.rotation,90);
  assert.deepEqual(first.pivot,{x:6,y:10});
  assert.deepEqual(first.origin,{x:5,y:9});
  assert.deepEqual(first.sockets,[{name:"glow",x:6,y:5,angle:0.5}]);
  assert.deepEqual(first.collisions,[{kind:"rect",name:"hot",x:4,y:2,width:3,height:4}]);
  assert.deepEqual(spriteDrawOrigin(first,40,50,1.25),{x:38.75,y:40});
  const rawGrid=unzipSync(gridBytes),rawSequence=unzipSync(sequenceBytes);
  for (const item of expected.clips) {
    const exact=source.manifest.clips.find(clip=>clip.id===item.id)!;
    const fixed=grid.manifest.clips.find(clip=>clip.id===item.id)!;
    const frameOrder=item.runs.flatMap(([index,count])=>Array.from({length:count},()=>index));
    assert.equal(fixed.direction,item.direction);
    assert.equal(fixed.loopMode,item.loopMode);
    assert.equal(fixed.durationErrorMs,0);
    assert.equal(fixed.totalFrames,frameOrder.length);
    assert.deepEqual(fixed.runs.map(run=>[Number(run.frameId.split(":").at(-1)),run.frameCount]),item.runs);
    assert.deepEqual(fixed.cues.map(cue=>[cue.name,cue.sourceTick,cue.outputFrame]),item.cues);
    assert.deepEqual(compileSpriteTimeline(exact).cues.map(cue=>[cue.event.cue.name,cue.tick]),item.cues.map(([name,tick])=>[name,tick]));

    // Slice the plain sheets with an independent PNG reader and the expected grid, without timing.json.
    const sheets=Object.keys(rawGrid).filter(name=>name.startsWith(item.id+"/")).sort();
    const plain=sheets.flatMap(name=>[...plainCells(PNG.sync.read(Buffer.from(rawGrid[name])),width,height)]);
    assert(plain.length>=frameOrder.length);
    for (const [index,sourceFrame] of frameOrder.entries()) {
      const frame=frameAtTick(exact,Math.floor(index*exact.ticksPerSecond/expected.fps));
      assert.equal(frame.sourceFrame,sourceFrame);
      const {width:cropWidth,height:cropHeight,pixels}=restoreSpritePixels(source.textures.get(frame.file)!,frame,source.manifest.texture);
      const full=new Uint8Array(width*height*4);
      for (let y=0;y<cropHeight;y++) full.set(pixels.subarray(y*cropWidth*4,(y+1)*cropWidth*4),
        ((frame.trimOffset.y+y)*width+frame.trimOffset.x)*4);
      const filename=`${item.id}/frame-${String(index+1).padStart(5,"0")}.png`;
      const numbered=PNG.sync.read(Buffer.from(rawSequence[filename]));
      assert.deepEqual(plain[index],full);
      assert.deepEqual(Uint8Array.from(numbered.data),full);
      assert.deepEqual(fixedSpritePixels(grid,item.id,index),full);
    }
    const loopTick=compileSpriteTimeline(exact).period;
    assert.equal(frameAtTick(exact,loopTick).sourceFrame,item.loopMode==="once"?2:0);
  }

  const corrupted=gridBytes.subarray(0,gridBytes.length-22);
  await assert.rejects(()=>openFixedSpriteBundle(corrupted));
  console.log("Verified 238 output frames, unequal holds, a blank cel, a rotated crop, pivot placement, cue positions and the loop seam.");
}

const action=process.argv[2];
async function main() {
  if (action===undefined) await verify();
  else if (action==="inspect" && process.argv[3]) await inspect(process.argv[3]);
  else throw new Error("Use npm run verify or npm run inspect -- path/to/export.zip.");
}

void main().catch(error=>{ console.error(error instanceof Error ? error.message : error); process.exitCode=1; });
