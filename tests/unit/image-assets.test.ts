import { expect,it } from "vitest";
import { unzipSync,zipSync } from "fflate";
import { PNG } from "pngjs";
import { editRig,type RigCommand } from "../../lib/rig/commands";
import { createBlankRig,type KinetixRigState } from "../../lib/rig/model";
import { inspectImage,verifyProjectImages } from "../../lib/import/image-inspection";
import { renderPngFrame } from "../../lib/export/raster";
import { supportedExport } from "../../lib/export/frames";
import { hasMissingArtworkImages } from "../../lib/rig/layer-tree";
import { archiveSummary,planProjectReopen,readProjectArchive,writeProjectArchive } from "../../lib/project/archive";
import { imageAssetFixture } from "../fixtures/image-assets";

const source=createBlankRig({name:"Image study",width:32,height:24,background:null});
const png=imageAssetFixture("image/png","#fc1030").toString("base64");
const webp=imageAssetFixture("image/webp","#28d020").toString("base64");
const asset={...inspectImage(png),id:"reference-sheet",name:"Reference sheet",folder:"Research"};
const put:RigCommand={type:"image.asset.put",asset,base64:png};
const place=(id:string,x:number,y:number,mode:"reference"|"artwork",boneId:string|null=null):RigCommand=>({
  type:"image.place",id,placement:{assetId:asset.id,name:id,mode,x,y,width:4,height:4,opacity:1,rotation:0,boneId},
});
const state=()=>editRig(source,[put,place("artwork-a",1,1,"artwork"),place("artwork-b",10,1,"artwork"),place("guide",19,1,"reference")])[0];
const snapshot=(rig:KinetixRigState)=>({rig,name:"Scene",fps:24,frameCount:1,startFrame:0,endFrame:0,tracks:[]});
const pixel=(rig:KinetixRigState,x:number,y:number)=>{
  const png=PNG.sync.read(renderPngFrame(snapshot(rig)));
  return Array.from(png.data.subarray((y*png.width+x)*4,(y*png.width+x)*4+4));
};

it("validates PNG and WebP bytes, shares placements and omits reference-only pixels",()=>{
  expect(asset).toMatchObject({width:4,height:4,mimeType:"image/png"});
  expect(inspectImage(webp)).toMatchObject({width:4,height:4,mimeType:"image/webp"});
  expect(()=>inspectImage(Buffer.from("not an image").toString("base64"))).toThrow("PNG or WebP");
  const excessive=Buffer.from(png,"base64");
  excessive.writeUInt32BE(40_000,16);
  expect(()=>inspectImage(excessive.toString("base64"))).toThrow("4096 pixels");
  const original=state();
  expect(original.images?.sources).toHaveLength(1);
  expect(pixel(original,2,2)).toEqual([252,16,48,255]);
  expect(pixel(original,11,2)).toEqual([252,16,48,255]);
  expect(pixel(original,20,2)).toEqual([0,0,0,0]);
  expect(supportedExport("lottie",snapshot(original))).toBe(false);
  const [replaced]=editRig(original,[{type:"image.asset.put",asset:{...asset,...inspectImage(webp)},base64:webp}]);
  expect(replaced.images?.sources).toHaveLength(1);
  expect(replaced.layers).toEqual(original.layers);
  const green=pixel(replaced,2,2);
  expect(green[1]).toBeGreaterThan(195);
  expect(pixel(replaced,11,2)).toEqual(green);
  expect(pixel(replaced,20,2)).toEqual([0,0,0,0]);
  expect(()=>verifyProjectImages({...replaced.images!,sources:[{sha256:asset.sha256,base64:webp}]})).toThrow("checksum");
  expect(()=>editRig(replaced,[{type:"image.asset.remove",id:asset.id}])).toThrow("placements");
});

it("keeps an image in place during a bone attachment and follows authored bone motion",()=>{
  const [original]=editRig(state(),[{type:"bone.create",bone:{id:"hand",name:"Hand",parentId:null,
    rotation:Math.PI/2,length:6,offset:{x:8,y:8}}}]);
  const [attached]=editRig(original,[{type:"image.update",id:"artwork-b",changes:{boneId:"hand"}}]);
  expect(pixel(attached,11,2)).toEqual(pixel(original,11,2));
  const [moved]=editRig(attached,[{type:"bone.update",id:"hand",changes:{offset:{x:13,y:8}}}]);
  expect(pixel(moved,11,2)).toEqual([0,0,0,0]);
  expect(pixel(moved,16,2)).toEqual([252,16,48,255]);
  const [detached]=editRig(moved,[{type:"bone.remove",id:"hand"}]);
  expect(pixel(detached,16,2)).toEqual([252,16,48,255]);
});

it("packages each image once, preserves linked placements on reopen and reports missing payloads",()=>{
  const original=state();
  const project={id:crypto.randomUUID(),name:"Image study",revision:4,state:original,clips:[]};
  const exported=writeProjectArchive(project);
  expect(exported.manifest.version).toBe(2);
  const files=unzipSync(exported.bytes);
  const [imagePath]=Object.keys(files).filter(name=>name.startsWith("images/"));
  expect(Object.keys(files)).toHaveLength(4);
  const packedDocument=JSON.parse(Buffer.from(files["document.json"]).toString("utf8"));
  expect(packedDocument.images.sources).toEqual([]);
  const restored=planProjectReopen(readProjectArchive(exported.bytes),"other user",crypto.randomUUID(),exported.bytes,"Received");
  expect(restored.state).toEqual(original);
  expect(renderPngFrame(snapshot(restored.state))).toEqual(renderPngFrame(snapshot(original)));
  const corrupted={...files,[imagePath]:Uint8Array.from(files[imagePath])};
  corrupted[imagePath][20]^=1;
  expect(()=>readProjectArchive(zipSync(corrupted))).toThrow("integrity check");
  delete files[imagePath];
  const missing=readProjectArchive(zipSync(files));
  expect(archiveSummary(missing).missingImages).toEqual([{id:asset.id,name:asset.name}]);
  expect(hasMissingArtworkImages(missing.state)).toBe(true);
  expect(supportedExport("png-sequence",snapshot(missing.state))).toBe(false);
  const [relinked]=editRig(missing.state,[put]);
  expect(hasMissingArtworkImages(relinked)).toBe(false);
  expect(relinked).toEqual(original);
});
