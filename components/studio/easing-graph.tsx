"use client";

import { useEffect, useRef, type PointerEvent } from "react";
import { easeSchema, linearEase, type Ease } from "@/lib/rig/animation";

const width = 420;
const height = 200;
const padding = 18;
const lower = -0.5;
const upper = 1.5;
const xAt = (x: number) => padding + x * (width - 2 * padding);
const yAt = (y: number) => height - padding - (y - lower) / (upper - lower) * (height - 2 * padding);

export function EasingGraph({value, change, close}: {value: Ease; change: (value: Ease) => void; close: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const active = useRef<1 | 2 | null>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    const g = canvas.current!.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, width, height);
    g.lineWidth = 1;
    g.strokeStyle = "#c5c8bb";
    g.strokeRect(xAt(0), yAt(1), xAt(1) - xAt(0), yAt(0) - yAt(1));
    g.beginPath();
    g.moveTo(xAt(0), yAt(0));
    g.lineTo(xAt(1), yAt(1));
    g.stroke();
    g.strokeStyle = "#686d60";
    g.beginPath();
    g.moveTo(xAt(0), yAt(0));
    g.lineTo(xAt(value.x1), yAt(value.y1));
    g.moveTo(xAt(1), yAt(1));
    g.lineTo(xAt(value.x2), yAt(value.y2));
    g.stroke();
    g.lineWidth = 2.5;
    g.strokeStyle = "#a94022";
    g.beginPath();
    g.moveTo(xAt(0), yAt(0));
    g.bezierCurveTo(xAt(value.x1), yAt(value.y1), xAt(value.x2), yAt(value.y2), xAt(1), yAt(1));
    g.stroke();
    g.fillStyle = "#a94022";
    for (const [x,y] of [[value.x1,value.y1],[value.x2,value.y2]]) {
      g.beginPath();
      g.arc(xAt(x), yAt(y), 5, 0, 2 * Math.PI);
      g.fill();
    }
  }, [value]);

  function coordinates(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * width / rect.width, y: (event.clientY - rect.top) * height / rect.height };
  }

  return <dialog ref={dialog} className="studio-easing" aria-label="Easing curve" onCancel={close}>
    <header><h2>Outgoing easing</h2><button onClick={close}>Done</button></header>
    <canvas ref={canvas} width={width} height={height} aria-label="Cubic Bézier curve" role="img" onPointerDown={event => {
      const point = coordinates(event);
      const first = Math.hypot(point.x - xAt(value.x1), point.y - yAt(value.y1));
      const second = Math.hypot(point.x - xAt(value.x2), point.y - yAt(value.y2));
      if (Math.min(first, second) > 24) return;
      active.current = first <= second ? 1 : 2;
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => {
      if (!active.current) return;
      const { x, y } = coordinates(event);
      const nextX = Math.min(1, Math.max(0, (x - padding) / (width - 2 * padding)));
      const nextY = Math.min(upper, Math.max(lower, lower + (height - padding - y) / (height - 2 * padding) * (upper - lower)));
      change(active.current === 1 ? { ...value, x1: nextX, y1: nextY } : { ...value, x2: nextX, y2: nextY });
    }} onLostPointerCapture={() => { active.current = null; }}/>
    <div className="studio-easing-points">{(["x1","y1","x2","y2"] as const).map(key => <label key={key}>
      {key.toUpperCase()}<input type="number" step="0.01" key={value[key]} defaultValue={Number(value[key].toFixed(3))} onBlur={event => {
        const next = easeSchema.safeParse({ ...value, [key]: event.currentTarget.valueAsNumber });
        if (next.success) change(next.data);
        else event.currentTarget.value = String(value[key]);
      }}/></label>)}</div>
    <button onClick={() => change(linearEase)}>Reset to linear</button>
  </dialog>;
}
