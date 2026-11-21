import { Hono } from "hono";
import { stream } from "hono/streaming";
import { validator } from "hono/validator";
import { z } from "zod";
import type { Library } from "../../db/library";
import type { IdentityEnv } from "../api";
import { formats } from "./frames";
import { exportRequest, queueExport } from "./requests";
import { readRigState, referenceFrameCount } from "../rig/model";
import { renderPngFrame } from "./raster";
import { prepareSpritePackage } from "./sprite-package";
import { spritePackageRequest } from "./sprite-package-options";
import { prepareSpriteBundle } from "./sprite-bundle";
import { fixedSpriteBundleRequest,spriteBundleRequest } from "./sprite-bundle-options";
import { prepareFixedSpriteBundle } from "./fixed-sprites";
import { hasMissingArtworkImages } from "../rig/layer-tree";
const missing = {error:"not_found"} as const;

export function exportApi(repository: () => Library) {
  return new Hono<IdentityEnv>()
    .post("/:id/fixed-sprites",validator("json",(value,c)=>{
      const parsed=fixedSpriteBundleRequest.safeParse(value);
      return parsed.success ? parsed.data : c.json({error:"invalid_export",detail:parsed.error.issues[0]?.message},400);
    }),async c=>{
      const rigId=c.req.param("id");
      const result=await prepareFixedSpriteBundle(repository().exports,c.get("userId")!,rigId,c.req.valid("json"));
      if ("error" in result && result.error) return c.json({error:result.error},result.status);
      c.header("Cache-Control","private, no-store");
      if (!result.bytes) return c.json(result.manifest);
      c.header("Content-Type","application/zip");
      c.header("Content-Disposition",`attachment; filename="kinetix-${rigId}-fixed-sprites.zip"`);
      return c.body(result.bytes);
    })
    .post("/:id/sprite-bundle",validator("json",(value,c)=>{
      const parsed=spriteBundleRequest.safeParse(value);
      return parsed.success ? parsed.data : c.json({error:"invalid_export",detail:parsed.error.issues[0]?.message},400);
    }),async c=>{
      const rigId=c.req.param("id");
      const result=await prepareSpriteBundle(repository().exports,c.get("userId")!,rigId,c.req.valid("json"));
      if ("error" in result && result.error) return c.json({error:result.error},result.status);
      c.header("Cache-Control","private, no-store");
      if (!result.bytes) return c.json(result.manifest);
      c.header("Content-Type","application/zip");
      c.header("Content-Disposition",`attachment; filename="kinetix-${rigId}-sprites.zip"`);
      return c.body(result.bytes);
    })
    .post("/:id/sprite-package",validator("json",(value,c) => {
      const parsed = spritePackageRequest.safeParse(value);
      return parsed.success ? parsed.data : c.json({error:"invalid_export"},400);
    }),async c => {
      const result = await prepareSpritePackage(repository().exports,c.get("userId")!,c.req.param("id"),c.req.valid("json"));
      if ("error" in result && result.error) return c.json({error:result.error},result.status);
      c.header("Cache-Control","private, no-store");
      if (!result.bytes) return c.json(result.manifest);
      c.header("Content-Type","application/zip");
      c.header("Content-Disposition",`attachment; filename="kinetix-${result.manifest.source.clipId}.zip"`);
      return c.body(result.bytes);
    })
    .get("/:id/artboard.png",async c => {
      const row = await repository().open(c.get("userId")!,c.req.param("id"));
      if (!row) return c.json(missing,404);
      const rig = readRigState(row.state);
      if (hasMissingArtworkImages(rig)) return c.json({error:"missing_image_assets",message:"Relink missing artwork images in Image assets before exporting."},422);
      const png = renderPngFrame({rig,name:row.name,tracks:[],fps:24,frameCount:referenceFrameCount(rig),startFrame:0,endFrame:0});
      c.header("Content-Type","image/png");
      c.header("Content-Disposition",'attachment; filename="kinetix-artboard.png"');
      c.header("Cache-Control","private, no-store");
      return c.body(new Uint8Array(png));
    })
    .get("/:id/exports",async c => {
      return c.json(await repository().exports.list(c.get("userId")!,c.req.param("id")));
    })
    .post("/:id/exports",validator("json",(value,c) => {
      const result = exportRequest.safeParse(value);
      return result.success ? result.data : c.json({error:"invalid_export"},400);
    }),async c => {
      const owner = c.get("userId")!;
      const rigId = c.req.param("id");
      const job = c.req.valid("json");
      const queue = repository().exports;
      const result = await queueExport(queue,owner,rigId,job);
      return "error" in result ? c.json({error:result.error},result.status) : c.json(result.job,202);
    })
    .get("/:id/exports/:job/download",async c => {
      const id = c.req.param("job");
      if (!z.uuid().safeParse(id).success) return c.json(missing,404);
      const job = await repository().exports.download(c.get("userId")!,c.req.param("id"),id);
      if (!job?.artifact) return c.json(missing,404);
      const { mime, extension } = formats[job.format];
      const file = Buffer.from(job.artifact,"base64");
      c.header("Content-Type",mime);
      c.header("Content-Disposition",`attachment; filename="kinetix-${id}.${extension}"`);
      c.header("X-Content-Type-Options","nosniff");
      return stream(c,async body => {
        for (let offset = 0; offset < file.length; offset += 128 * 1024) {
          if (body.aborted) return;
          await body.write(file.subarray(offset,offset + 128 * 1024));
        }
      });
    });
}
