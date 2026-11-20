import type { SpriteBundleRequest } from "./sprite-bundle-options";

export type SpriteSize = {width:number;height:number};
export type SpriteRect = SpriteSize & {x:number;y:number};
export type SpriteCrop = SpriteRect & {blank:boolean;rgba:Uint8ClampedArray};
export type SpritePlacement = {page:number;rect:SpriteRect;rotation:0|90};
export type SpritePage = SpriteSize & {file:string};

export function cropSprite(rgba:Uint8ClampedArray,{width,height}:SpriteSize,trim:boolean):SpriteCrop {
  let left=width;
  let top=height;
  let right=-1;
  let bottom=-1;
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    if (rgba[(y*width+x)*4+3]===0) continue;
    left=Math.min(left,x);
    right=Math.max(right,x);
    top=Math.min(top,y);
    bottom=Math.max(bottom,y);
  }
  const blank=right<0;
  if (!trim) return {x:0,y:0,width,height,blank,rgba};
  if (blank) return {x:0,y:0,width:1,height:1,blank,rgba:new Uint8ClampedArray(4)};
  const croppedWidth=right-left+1;
  const croppedHeight=bottom-top+1;
  if (croppedWidth===width && croppedHeight===height) return {x:0,y:0,width,height,blank,rgba};
  const output=new Uint8ClampedArray(croppedWidth*croppedHeight*4);
  for (let row=0;row<croppedHeight;row++) {
    const start=((row+top)*width+left)*4;
    output.set(rgba.subarray(start,start+croppedWidth*4),row*croppedWidth*4);
  }
  return {x:left,y:top,width:croppedWidth,height:croppedHeight,blank,rgba:output};
}

const atlasName=(index:number)=>"atlas/"+String(index+1).padStart(3,"0")+".png";
const frameName=(index:number)=>"frames/"+String(index+1).padStart(5,"0")+".png";

function looseLayout(frames:readonly SpriteSize[],maximum:number) {
  if (frames.some(frame=>frame.width>maximum || frame.height>maximum)) return undefined;
  return {
    pages:frames.map(({width,height},index)=>({file:frameName(index),width,height})),
    placements:frames.map(({width,height},index):SpritePlacement=>({
      page:index,rect:{x:0,y:0,width,height},rotation:0,
    })),
  };
}

function fixedLayout(frames:readonly SpriteSize[],maximum:number) {
  const {width,height}=frames[0];
  const maxColumns=Math.floor(maximum/width);
  const maxRows=Math.floor(maximum/height);
  if (!maxColumns || !maxRows) return undefined;
  const pages:SpritePage[]=[];
  const placements:SpritePlacement[]=[];
  while (placements.length<frames.length) {
    const count=Math.min(frames.length-placements.length,maxColumns*maxRows);
    const columns=Math.min(maxColumns,Math.max(Math.ceil(count/maxRows),Math.ceil(Math.sqrt(count*height/width))));
    const rows=Math.ceil(count/columns);
    const page=pages.length;
    pages.push({file:atlasName(page),width:columns*width,height:rows*height});
    for (let i=0;i<count;i++) placements.push({
      page,rect:{x:i%columns*width,y:Math.floor(i/columns)*height,width,height},rotation:0,
    });
  }
  return {pages,placements};
}

type Shelf = {y:number;height:number;used:number};
type Atlas = SpritePage & {shelves:Shelf[]};
type Packing = NonNullable<SpriteBundleRequest["packing"]>;

function packedLayout(frames:readonly SpriteSize[],maximum:number,settings:Packing) {
  const border=settings.extrusion+settings.padding;
  const ordered=frames.map((frame,index)=>({...frame,index})).sort((left,right)=>
    Math.max(right.width,right.height)-Math.max(left.width,left.height) ||
    right.width*right.height-left.width*left.height || left.index-right.index);
  const pages:Atlas[]=[];
  const placements:SpritePlacement[]=new Array(frames.length);
  for (const item of ordered) {
    const normal={width:item.width,height:item.height,rotation:0 as const};
    const rotated={width:item.height,height:item.width,rotation:90 as const};
    const shapes=settings.rotate && item.width!==item.height ? [normal,rotated] : [normal];
    const candidates=shapes.filter(shape=>shape.width+2*border<=maximum && shape.height+2*border<=maximum);
    if (!candidates.length) return undefined;
    const existing: {page:number;shelf:Shelf;shape:typeof normal|typeof rotated;remaining:number}[]=[];
    for (const [page,atlas] of pages.entries()) for (const shelf of atlas.shelves) for (const shape of candidates) {
      const remaining=maximum-shelf.used-shape.width-2*border;
      if (remaining>=0 && shape.height+2*border<=shelf.height) existing.push({page,shelf,shape,remaining});
    }
    existing.sort((a,b)=>a.remaining-b.remaining || a.shelf.height-b.shelf.height || a.page-b.page ||
      a.shelf.y-b.shelf.y || a.shape.rotation-b.shape.rotation);
    let chosen=existing[0];
    if (!chosen) {
      const shape=candidates.sort((a,b)=>a.height-b.height || a.rotation-b.rotation)[0];
      const height=shape.height+2*border;
      let page=pages.findIndex(atlas=>atlas.height+height<=maximum);
      if (page<0) {
        page=pages.length;
        pages.push({file:atlasName(page),width:0,height:0,shelves:[]});
      }
      const atlas=pages[page];
      const shelf={y:atlas.height,height,used:0};
      atlas.shelves.push(shelf);
      atlas.height+=height;
      chosen={page,shelf,shape,remaining:maximum-shape.width-2*border};
    }
    const {page,shelf,shape}=chosen;
    placements[item.index]={page,rotation:shape.rotation,rect:{
      x:shelf.used+border,y:shelf.y+border,width:shape.width,height:shape.height,
    }};
    shelf.used+=shape.width+2*border;
    pages[page].width=Math.max(pages[page].width,shelf.used);
  }
  return {pages:pages.map(({file,width,height})=>({file,width,height})),placements};
}

export function placeSprites(frames:readonly SpriteSize[],layout:SpriteBundleRequest["layout"],maximum:number,settings:Packing) {
  if (!frames.length) return undefined;
  if (layout==="loose") return looseLayout(frames,maximum);
  if (layout==="fixed-grid") return fixedLayout(frames,maximum);
  return packedLayout(frames,maximum,settings);
}

const linear = Uint8Array.from({length:256},(_,index)=>{
  const normalized=index/255;
  return Math.round(255*(normalized<=0.04045 ? normalized/12.92 : ((normalized+0.055)/1.055)**2.4));
});
const clamp = (value:number,max:number)=>Math.max(0,Math.min(value,max));

/** Copy a sprite and optionally duplicate its edge pixels into the sampling border. */
export function blitSprite(destination:Uint8Array,pageWidth:number,source:SpriteCrop,placement:SpritePlacement,
  extrusion:number,colorSpace:SpriteBundleRequest["colorSpace"],alpha:SpriteBundleRequest["alpha"]) {
  const {x,y,width,height}=placement.rect;
  for (let row=-extrusion;row<height+extrusion;row++) {
    const py=clamp(row,height-1);
    for (let column=-extrusion;column<width+extrusion;column++) {
      const px=clamp(column,width-1);
      const sourceX=placement.rotation===90 ? py : px;
      const sourceY=placement.rotation===90 ? source.height-1-px : py;
      const src=(sourceY*source.width+sourceX)*4;
      const dest=((y+row)*pageWidth+x+column)*4;
      const opacity=source.rgba[src+3];
      destination[dest+3]=opacity;
      for (let channel=0;channel<3;channel++) {
        const value=source.rgba[src+channel];
        const converted=colorSpace==="linear" ? linear[value] : value;
        destination[dest+channel]=alpha==="premultiplied" ? Math.round(converted*opacity/255) : converted;
      }
    }
  }
}
