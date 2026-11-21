"use client";

import { useEffect,useState } from "react";
import type { ImageCatalog } from "@/lib/rig/images";

export function useImageBitmaps(catalog:ImageCatalog|undefined) {
  const [loaded,setLoaded]=useState<{catalog:ImageCatalog;images:Map<string,HTMLImageElement>}>();
  useEffect(()=>{
    if (!catalog?.sources.length) return;
    let cancelled=false;
    const types=new Map(catalog.assets.map(asset=>[asset.sha256,asset.mimeType]));
    const bitmaps=new Map<string,HTMLImageElement>();
    for (const source of catalog.sources) {
      const image=new Image();
      image.src=`data:${types.get(source.sha256)};base64,${source.base64}`;
      bitmaps.set(source.sha256,image);
    }
    void Promise.allSettled([...bitmaps.values()].map(image=>image.decode())).then(()=>{
      if (!cancelled) setLoaded({catalog,images:bitmaps});
    });
    return ()=>{cancelled=true;};
  },[catalog]);
  return loaded?.catalog===catalog ? loaded?.images : undefined;
}
