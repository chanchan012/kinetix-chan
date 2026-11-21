import type { SKRSContext2D,Image } from "@napi-rs/canvas";
import { loadProjectImage } from "../import/image-inspection";
import type { KinetixRigState } from "../rig/model";
import type { ImagePainter } from "../rig/render";

export function createImagePainter(context:SKRSContext2D,rig:KinetixRigState):ImagePainter {
  const sources=new Map(rig.images?.sources.map(source=>[source.sha256,source]));
  const images=new Map<string,Image>();
  return (asset,placement)=>{
    let image=images.get(asset.sha256);
    if (!image) {
      const source=sources.get(asset.sha256);
      if (!source) throw new Error(`Relink ${asset.name} before rendering this image layer.`);
      image=loadProjectImage(source).image;
      images.set(asset.sha256,image);
    }
    context.drawImage(image,0,0,placement.width,placement.height);
  };
}
