import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { strToU8,zipSync } from "fflate";
import { z } from "zod";
import { fixedSpriteManifest } from "@/lib/export/fixed-sprite-manifest";
import { fixedSpriteBundleRequest,spriteBundleRequest } from "@/lib/export/sprite-bundle-options";
import { prepareSpriteBundle } from "@/lib/export/sprite-bundle";
import { prepareFixedSpriteBundle } from "@/lib/export/fixed-sprites";
import { atlasProject,spriteExampleClips,spriteExampleQueue } from "@/lib/export/sprite-example";
import { spriteBundleManifest } from "@/lib/export/sprite-playback";

export const dynamic="force-static";

export async function GET() {
  const clips=[spriteExampleClips[0],{...spriteExampleClips[1],frames:spriteExampleClips[1].frames.map(frame=>
    frame.frame===1 ? {...frame,events:[{name:"stride",tick:1,data:{foot:"left"}}]} : frame)}];
  const source=await prepareSpriteBundle(spriteExampleQueue,"example",atlasProject,spriteBundleRequest.parse({
    revision:7,clips,layout:"packed",maxTextureSize:16,packing:{padding:1,extrusion:1,rotate:true},
  }));
  const fixed=await Promise.all((["fixed-grid","loose"] as const).map(layout=>prepareFixedSpriteBundle(
    spriteExampleQueue,"example",atlasProject,fixedSpriteBundleRequest.parse({revision:7,clips,layout,fps:24,maxTextureSize:64}),
  )));
  if (!source.bytes || !fixed[0].bytes || !fixed[1].bytes) throw new Error("The sprite conformance fixtures did not export.");

  const fixturePath="integrations/sprite-conformance/";
  const files=await Promise.all([
    ...["README.md","package.json","package-lock.json"].map(name=>[name,fixturePath+name]),
    [fixturePath+"verify.ts",fixturePath+"verify.ts"],
    ["examples/expected.json",fixturePath+"expected.json"],
    ...["lib/export/sprite-playback.ts","lib/export/fixed-sprite-manifest.ts","lib/export/fixed-sprite-timing.ts",
      "lib/rig/sprite-sources.ts"].map(name=>[name,name]),
  ].map(async ([name,file])=>[name,await readFile(join(process.cwd(),file))] as const));
  const schema=(target:z.ZodType)=>strToU8(JSON.stringify(z.toJSONSchema(target,{io:"input"}),null,2));
  const zip=zipSync({
    ...Object.fromEntries(files),
    "examples/source-v2.zip":source.bytes,"examples/grid-24.zip":fixed[0].bytes,"examples/frames-24.zip":fixed[1].bytes,
    "schemas/sprite-v2.json":schema(spriteBundleManifest),"schemas/fixed-sprites-v1.json":schema(fixedSpriteManifest),
  },{mtime:new Date(1980,0,1)});
  return new Response(Uint8Array.from(zip),{headers:{
    "Content-Type":"application/zip","Content-Disposition":'attachment; filename="kinetix-sprite-conformance.zip"',
  }});
}
