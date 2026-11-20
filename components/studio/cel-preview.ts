import { paintCelRuns, type Cel, type Drawing } from "@/lib/rig/drawings";

/** Rasterize an authored cel once, then scale its pixels with nearest filtering. */
export function createCelPreview() {
  type Entry = {cel:Cel;storage:Drawing["storage"];tint?:string;surface:HTMLCanvasElement;x:number;y:number};
  const recent:Entry[] = [];
  return (context:CanvasRenderingContext2D,drawing:Drawing,cel:Cel,tint?:string) => {
    const index = recent.findIndex(entry=>entry.cel===cel && entry.storage===drawing.storage && entry.tint===tint);
    let entry = index>=0 ? recent.splice(index,1)[0] : undefined;
    if (!entry) {
      let left=drawing.width;
      let right=0;
      for (const [,x,width] of cel.runs) {
        left=Math.min(left,x);
        right=Math.max(right,x+width);
      }
      const top=cel.runs[0][0];
      const height=cel.runs.at(-1)![0]-top+1;
      const surface=document.createElement("canvas");
      surface.width=right-left;
      surface.height=height;
      const bitmap=surface.getContext("2d")!;
      bitmap.translate(-left,-top);
      paintCelRuns(bitmap,drawing,cel,tint);
      entry={cel,storage:drawing.storage,tint,surface,x:left,y:top};
    }
    recent.unshift(entry);
    let pixels=0;
    const overBudget=recent.findIndex(({surface},i)=>{
      pixels+=surface.width*surface.height;
      return i>0 && (pixels>8_000_000 || i>=8);
    });
    if (overBudget>=0) recent.length=overBudget;
    context.imageSmoothingEnabled=false;
    context.drawImage(entry.surface,entry.x,entry.y);
  };
}
