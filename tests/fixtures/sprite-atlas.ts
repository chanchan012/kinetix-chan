import { prepareSpriteBundle } from "../../lib/export/sprite-bundle";
import { spriteBundleRequest,type SpriteBundleRequest } from "../../lib/export/sprite-bundle-options";
import { openSpriteBundle,restoreSpritePixels } from "../../lib/export/sprite-playback";
import { atlasProject,spriteExampleClips,spriteExampleQueue } from "../../lib/export/sprite-example";

export { atlasProject };

export async function exportedAtlasFixture(layout:SpriteBundleRequest["layout"]="packed",scale=1) {
  const request=spriteBundleRequest.parse({revision:7,layout,scale,maxTextureSize:layout==="packed" ? 16 : 64,
    ...(layout==="packed" && {packing:{padding:1,extrusion:1,rotate:true}}),clips:spriteExampleClips});
  const fixture=await prepareSpriteBundle(spriteExampleQueue,"owner",atlasProject,request);
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
