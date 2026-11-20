"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

type Panel = "hierarchy" | "inspector" | "split" | "timeline";
type PanelSize = { min: number; max: number; value: number; set: (value: number) => void };
const clamp = (value: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, value)));

export function usePanelLayout(hasClip: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 1100, height: 720 });
  const [sizes, setSizes] = useState<Partial<Record<Panel, number>>>({});
  useEffect(() => {
    const grid = ref.current!;
    const observer = new ResizeObserver(([entry]) => {
      setBounds({width:entry.contentRect.width, height:entry.contentRect.height});
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  const narrow = bounds.width <= 720;
  const sideHeight = Math.min(170, Math.max(86, Math.round(bounds.height * .26)));
  const leftMin = 132;
  const rightMin = 158;
  const available = bounds.width - 242;
  const left = clamp(sizes.hierarchy ?? 188, leftMin, Math.max(leftMin, Math.min(420, available - rightMin)));
  const right = clamp(sizes.inspector ?? 212, rightMin, Math.max(rightMin, Math.min(460, available - left)));
  const leftMax = Math.max(leftMin, Math.min(420, available - right));
  const rightMax = Math.max(rightMin, Math.min(460, available - left));
  const splitMin = Math.min(122, Math.round(bounds.width * .36));
  const splitMax = Math.max(splitMin, Math.round(bounds.width * .62));
  const timelineMax = Math.max(80, bounds.height - (narrow ? sideHeight + 120 : 157));
  const control = (key: Panel, min: number, max: number, fallback: number): PanelSize => ({
    min, max, value: clamp(sizes[key] ?? fallback, min, max),
    set: value => setSizes(current => ({...current, [key]:clamp(value,min,max)})),
  });
  const panels = {
    hierarchy: control("hierarchy",leftMin,leftMax,left),
    inspector: control("inspector",rightMin,rightMax,right),
    split: control("split",splitMin,splitMax,bounds.width / 2),
    timeline: control("timeline",80,timelineMax,hasClip ? 174 : 96),
  };
  const style = {
    "--hierarchy-width": panels.hierarchy.value + "px",
    "--inspector-width": panels.inspector.value + "px",
    "--split-width": panels.split.value + "px",
    "--timeline-height": panels.timeline.value + "px",
    "--sidebar-height": sideHeight + "px",
  } as CSSProperties;
  return {ref, style, panels};
}

export function PanelHandle({panel, orientation = "vertical", direction = 1, size, label, controls}: {
  panel: Panel; orientation?: "vertical" | "horizontal"; direction?: 1 | -1; size: PanelSize; label: string; controls: string;
}) {
  const drag = useRef<{ id: number; start: number; value: number } | null>(null);
  return <div className={"studio-resize studio-resize-" + panel} role="separator" tabIndex={0}
    aria-label={label} aria-controls={controls} aria-orientation={orientation}
    aria-valuemin={size.min} aria-valuemax={size.max} aria-valuenow={size.value}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0) return;
      const coordinate = orientation === "vertical" ? event.clientX : event.clientY;
      drag.current = {id:event.pointerId, start:coordinate, value:size.value};
      event.currentTarget.focus({preventScroll:true});
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    }}
    onPointerMove={event => {
      const active = drag.current;
      if (active?.id !== event.pointerId) return;
      const coordinate = orientation === "vertical" ? event.clientX : event.clientY;
      size.set(active.value + direction * (coordinate - active.start));
    }}
    onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => {
      const forward = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
      const backward = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
      const step = event.shiftKey ? 24 : 8;
      if (event.key === forward) size.set(size.value + direction * step);
      else if (event.key === backward) size.set(size.value - direction * step);
      else if (event.key === "Home") size.set(size.min);
      else if (event.key === "End") size.set(size.max);
      else return;
      event.preventDefault();
    }}/>;
}
