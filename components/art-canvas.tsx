"use client";
import { useEffect, useRef } from "react";
import { drawStudy } from "@/lib/artwork";
import type { Study } from "@/lib/studies";

export function ArtCanvas({study, frame = 0, rig = false, mini = false}: {
  study: Study; frame?: number; rig?: boolean; mini?: boolean
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const draw = useRef<() => void>(() => {});
  const state = useRef({study, frame, rig, mini});
  useEffect(() => {
    state.current = {study, frame, rig, mini};
    draw.current();
  }, [study,frame,rig,mini]);
  useEffect(() => {
    const element = canvas.current!;
    const g = element.getContext("2d");
    if (!g) return;
    let width = 0, height = 0;
    draw.current = () => {
      if (!width || !height) return;
      const {study, frame, rig, mini} = state.current;
      const scale = Math.min(width / (mini ? 485 : 510), height / (mini ? 230 : 300));
      g.setTransform(element.width/width,0,0,element.height/height,0,0);
      g.clearRect(0,0,width,height);
      g.translate(width/2,height/2);
      g.scale(scale,scale);
      g.translate(-241,-135);
      if (!mini) {
        g.fillStyle = "#5146320d";
        g.beginPath(); g.ellipse(252,242,145,5,0,0,2*Math.PI); g.fill();
      }
      drawStudy(g,study.id,frame/study.frames,rig);
    };
    const resize = new ResizeObserver(([entry]) => {
      ({width, height} = entry.contentRect);
      const dpr = Math.min(devicePixelRatio || 1,2);
      element.width = Math.round(width*dpr); element.height = Math.round(height*dpr);
      draw.current();
    });
    resize.observe(element);
    return () => { resize.disconnect(); draw.current = () => {}; };
  }, []);
  return <canvas ref={canvas} aria-hidden="true" className="art-canvas" />;
}
