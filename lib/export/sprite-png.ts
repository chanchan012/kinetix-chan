import { deflateSync } from "node:zlib";
import type { SpriteBundleRequest } from "./sprite-bundle-options";

const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const crcTable=Uint32Array.from({length:256},(_,byte)=>{
  let value=byte;
  for (let bit=0;bit<8;bit++) value=value&1 ? 0xedb88320^(value>>>1) : value>>>1;
  return value>>>0;
});

function chunk(name:string,data:Uint8Array):Buffer {
  const bytes=Buffer.allocUnsafe(data.length+12);
  bytes.writeUInt32BE(data.length,0);
  bytes.write(name,4,"ascii");
  bytes.set(data,8);
  let crc=0xffffffff;
  for (let i=4;i<8+data.length;i++) crc=crcTable[(crc^bytes[i])&255]^(crc>>>8);
  bytes.writeUInt32BE((crc^0xffffffff)>>>0,8+data.length);
  return bytes;
}

/** Preserve texture channel bytes even for a premultiplied export. */
export function spritePng(width:number,height:number,rgba:Uint8Array,space:SpriteBundleRequest["colorSpace"]):Buffer {
  const stride=width*4;
  const filtered=Buffer.allocUnsafe((stride+1)*height);
  for (let y=0;y<height;y++) {
    const start=y*stride;
    const row=y*(stride+1);
    filtered[row]=1;
    for (let i=0;i<stride;i++) filtered[row+1+i]=rgba[start+i]-(i>=4 ? rgba[start+i-4] : 0);
  }
  const header=Buffer.alloc(13);
  header.writeUInt32BE(width,0);
  header.writeUInt32BE(height,4);
  header[8]=8;
  header[9]=6;
  const color=space==="srgb" ? chunk("sRGB",Buffer.from([0])) : chunk("gAMA",Buffer.from([0,1,134,160]));
  return Buffer.concat([signature,chunk("IHDR",header),color,chunk("IDAT",deflateSync(filtered,{level:5})),chunk("IEND",Buffer.alloc(0))]);
}
