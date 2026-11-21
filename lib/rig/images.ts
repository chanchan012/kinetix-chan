import { z } from "zod";

export const imageFileBytes=1024*1024;
export const imageProjectBytes=1536*1024;
export const imageDimension=4096;
export const imageCount=64;
export const imageMime=z.enum(["image/png","image/webp"]);
export const imageDigest=z.string().regex(/^[a-f0-9]{64}$/);
export const imageName=z.string().trim().min(1).max(120);
export const imageFolder=z.string().trim().max(120);
export const imageId=z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
export const imageBase64=z.string().min(4).max(4*Math.ceil(imageFileBytes/3))
  .regex(/^[A-Za-z0-9+/]+={0,2}$/).refine(value=>value.length%4===0);

export const imageDescription=z.strictObject({
  sha256:imageDigest,mimeType:imageMime,width:z.int().min(1).max(imageDimension),height:z.int().min(1).max(imageDimension),
});
export const imageAssetSchema=imageDescription.extend({id:imageId,name:imageName,folder:imageFolder.default("")});
export const imageSourceSchema=z.strictObject({sha256:imageDigest,base64:imageBase64});
export const inspectImageInput=z.strictObject({base64:imageBase64});
export const imageCatalogSchema=z.strictObject({assets:z.array(imageAssetSchema).max(imageCount),sources:z.array(imageSourceSchema).max(imageCount)})
  .superRefine((catalog,context)=>{
    const ids=new Set<string>();
    const descriptions=new Map<string,ImageAsset>();
    for (const asset of catalog.assets) {
      const existing=descriptions.get(asset.sha256);
      if (ids.has(asset.id) || (existing && (existing.width!==asset.width || existing.height!==asset.height || existing.mimeType!==asset.mimeType))) {
        context.addIssue({code:"custom",message:"Image asset IDs must be unique and shared bytes must have matching dimensions and type."});
        return;
      }
      ids.add(asset.id);
      descriptions.set(asset.sha256,asset);
    }
    const sources=new Set<string>();
    let total=0;
    let pixels=0;
    for (const source of catalog.sources) {
      const asset=descriptions.get(source.sha256);
      if (!asset || sources.has(source.sha256)) {
        context.addIssue({code:"custom",message:"Each embedded image needs a unique digest and a declared asset."});
        return;
      }
      sources.add(source.sha256);
      total+=source.base64.length*3/4-(source.base64.endsWith("==") ? 2 : source.base64.endsWith("=") ? 1 : 0);
      pixels+=asset.width*asset.height;
    }
    if (total>imageProjectBytes || pixels>24*1024*1024) {
      context.addIssue({code:"custom",message:"The image catalog exceeds 1.5 MiB of embedded images or the decoded pixel limit."});
    }
  });

const coordinate=z.number().min(-1_000_000).max(1_000_000);
export const imagePlacementSchema=z.strictObject({
  assetId:imageId,name:imageName,mode:z.enum(["reference","artwork"]),
  x:coordinate,y:coordinate,width:z.number().min(0.1).max(8192),height:z.number().min(0.1).max(8192),
  opacity:z.number().min(0).max(1),rotation:z.number().min(-1000).max(1000),boneId:imageId.nullable(),
});

export type ImageAsset=z.output<typeof imageAssetSchema>;
export type ImageSource=z.output<typeof imageSourceSchema>;
export type ImageCatalog=z.output<typeof imageCatalogSchema>;
export type ImagePlacement=z.output<typeof imagePlacementSchema>;

export function fitImagePlacement(asset:ImageAsset,artboard:{width:number;height:number},mode:ImagePlacement["mode"]):ImagePlacement {
  const scale=Math.min(1,artboard.width/asset.width,artboard.height/asset.height);
  const width=asset.width*scale;
  const height=asset.height*scale;
  return {assetId:asset.id,name:asset.name,mode,x:(artboard.width-width)/2,y:(artboard.height-height)/2,width,height,
    opacity:1,rotation:0,boneId:null};
}
