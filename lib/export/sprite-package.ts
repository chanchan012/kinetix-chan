import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import type { z } from "zod";
import type { ExportQueue } from "../../db/exports";
import { artboardFor, readRigState } from "../rig/model";
import { exportSnapshotSchema, spritesheetGrid, supportedExport } from "./frames";
import { renderSpritesheet } from "./raster";
import { spriteMaxFrames, type spritePackageRequest } from "./sprite-package-options";

type Request = z.output<typeof spritePackageRequest>;
const maximumPackageBytes = 1_500_000;

export async function prepareSpritePackage(queue:Pick<ExportQueue,"inputs">, owner:string, rigId:string, request:Request) {
  const source = await queue.inputs(owner,rigId,request.clipId);
  if (!source?.clip) return {error:"not_found",status:404} as const;
  if (source.revision !== request.revision || source.clip.trackRevision !== request.trackRevision) {
    return {error:"revision_conflict",status:409} as const;
  }
  const rig = readRigState(source.state);
  const range = { startFrame:request.startFrame, endFrame:request.endFrame };
  const snapshot = exportSnapshotSchema.safeParse({
    rig, ...range, name:source.clip.name, fps:source.clip.fps,
    frameCount:source.clip.frameCount, tracks:source.clip.tracks,
  });
  const count = request.endFrame - request.startFrame + 1;
  if (!snapshot.success || count > spriteMaxFrames || !supportedExport("spritesheet",snapshot.data)) {
    return {error:"unsupported_range",status:400} as const;
  }
  const {width,height} = artboardFor(rig);
  const {columns,rows} = spritesheetGrid(count,width,height);
  if (width * height * columns * rows > 16 * 1024 * 1024) return {error:"atlas_too_large",status:400} as const;
  const manifest = {
    schema:"kinetix.sprite-package", version:1, layout:"fixed-grid",
    source:{rigId,revision:source.revision,clipId:source.clip.id,trackRevision:source.clip.trackRevision},
    atlas:{file:"atlas.png",width:width*columns,height:height*rows,columns,rows,
      alpha:"straight",colorSpace:"srgb",filter:request.filter},
    clip:{name:source.clip.name,fps:source.clip.fps,loop:request.loop,...range},
    frames:Array.from({length:count},(_,index) => ({
      sourceFrame:request.startFrame + index,durationTicks:1,
      rect:{x:index % columns * width,y:Math.floor(index / columns) * height,width,height},
      sourceSize:{width,height},trimOffset:{x:0,y:0},pivot:request.pivot ?? {x:width / 2,y:height},
    })),
  };
  if (request.preflight) return {manifest} as const;
  const atlas = renderSpritesheet(snapshot.data);
  const digest = createHash("sha256").update(atlas).digest("hex");
  const complete = {...manifest, atlas:{...manifest.atlas, sha256:digest}};
  const bytes = zipSync({"kinetix.json":strToU8(JSON.stringify(complete,null,2)),"atlas.png":atlas},
    {level:0,mtime:new Date(1980,0,1)});
  if (bytes.length > maximumPackageBytes) return {error:"package_too_large",status:400} as const;
  return {manifest:complete,bytes} as const;
}
