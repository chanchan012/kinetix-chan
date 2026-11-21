import { createHash } from "node:crypto";
import { Image } from "@napi-rs/canvas";
import { imageDescription,imageDimension,imageFileBytes,type ImageCatalog,type ImageSource } from "../rig/images";

const pngSignature=Buffer.from([137,80,78,71,13,10,26,10]);
const maxImagePixels=8*1024*1024;

function dimensions(width:number,height:number) {
  if (width<1 || height<1 || width>imageDimension || height>imageDimension || width*height>maxImagePixels) {
    throw new Error("Choose an image up to 4096 pixels per side and 8 megapixels.");
  }
  return {width,height};
}

function pngDimensions(bytes:Buffer) {
  if (bytes.length<33 || bytes.readUInt32BE(8)!==13 || bytes.toString("ascii",12,16)!=="IHDR") {
    throw new Error("The PNG header is incomplete.");
  }
  const size=dimensions(bytes.readUInt32BE(16),bytes.readUInt32BE(20));
  for (let offset=8;offset+12<=bytes.length;) {
    const length=bytes.readUInt32BE(offset);
    const type=bytes.toString("ascii",offset+4,offset+8);
    offset+=12+length;
    if (offset>bytes.length) break;
    if (type==="acTL") throw new Error("Choose a still PNG or WebP image.");
    if (type==="IEND" && length===0 && offset===bytes.length) return size;
  }
  throw new Error("The PNG is incomplete.");
}

function webpDimensions(bytes:Buffer) {
  if (bytes.length<20 || bytes.readUInt32LE(4)!==bytes.length-8) throw new Error("The WebP container is incomplete.");
  let canvas:ReturnType<typeof dimensions>|undefined;
  let raster:ReturnType<typeof dimensions>|undefined;
  let offset=12;
  while (offset+8<=bytes.length) {
    const type=bytes.toString("ascii",offset,offset+4);
    const length=bytes.readUInt32LE(offset+4);
    const start=offset+8;
    offset=start+length+length%2;
    if (offset>bytes.length) throw new Error("The WebP container is incomplete.");
    if (type==="ANIM" || type==="ANMF") throw new Error("Choose a still PNG or WebP image.");
    if (type==="VP8X" && length===10 && !canvas) {
      if (bytes[start]&2) throw new Error("Choose a still PNG or WebP image.");
      canvas=dimensions(1+bytes.readUIntLE(start+4,3),1+bytes.readUIntLE(start+7,3));
    } else if (type==="VP8L" && length>=5 && !raster && bytes[start]===0x2f) {
      const bits=bytes.readUInt32LE(start+1);
      raster=dimensions(1+(bits&0x3fff),1+((bits>>>14)&0x3fff));
    } else if (type==="VP8 " && length>=10 && !raster && bytes.readUIntBE(start+3,3)===0x9d012a) {
      raster=dimensions(bytes.readUInt16LE(start+6)&0x3fff,bytes.readUInt16LE(start+8)&0x3fff);
    } else if (["VP8X","VP8L","VP8 "].includes(type)) throw new Error("The WebP image header is invalid.");
  }
  if (!raster || offset!==bytes.length || (canvas && (canvas.width!==raster.width || canvas.height!==raster.height))) {
    throw new Error("The WebP canvas and image dimensions do not match.");
  }
  return raster;
}

export function loadProjectImage(source:ImageSource) {
  const bytes=Buffer.from(source.base64,"base64");
  if (bytes.length>imageFileBytes || bytes.toString("base64")!==source.base64) throw new Error("Choose an image of 1 MiB or less with valid bytes.");
  if (createHash("sha256").update(bytes).digest("hex")!==source.sha256) throw new Error("The image checksum does not match its bytes.");
  const png=bytes.subarray(0,8).equals(pngSignature);
  const webp=bytes.toString("ascii",0,4)==="RIFF" && bytes.toString("ascii",8,12)==="WEBP";
  if (!png && !webp) throw new Error("Choose a PNG or WebP image.");
  const size=png ? pngDimensions(bytes) : webpDimensions(bytes);
  const image=new Image();
  image.src=bytes;
  if (!image.complete || image.width!==size.width || image.height!==size.height) throw new Error("The image could not be decoded.");
  return {image,description:imageDescription.parse({sha256:source.sha256,mimeType:png ? "image/png" : "image/webp",...size})};
}

export function inspectImage(base64:string) {
  const sha256=createHash("sha256").update(Buffer.from(base64,"base64")).digest("hex");
  return loadProjectImage({sha256,base64}).description;
}

export function verifyProjectImages(catalog:ImageCatalog|undefined) {
  if (!catalog?.sources.length) return;
  const descriptions=new Map(catalog.assets.map(asset=>[asset.sha256,asset]));
  for (const source of catalog.sources) {
    const expected=descriptions.get(source.sha256)!;
    const {description}=loadProjectImage(source);
    if (description.mimeType!==expected.mimeType || description.width!==expected.width || description.height!==expected.height) {
      throw new Error("An image does not match its declared type or dimensions.");
    }
  }
}
