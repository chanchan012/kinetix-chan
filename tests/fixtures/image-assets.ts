import { createCanvas } from "@napi-rs/canvas";

export function imageAssetFixture(format:"image/png"|"image/webp",color:string) {
  const canvas=createCanvas(4,4);
  const context=canvas.getContext("2d");
  context.fillStyle=color;
  context.fillRect(0,0,3,3);
  return format==="image/png" ? canvas.toBuffer("image/png") : canvas.toBuffer("image/webp");
}
