"use client";

import { useEffect, useRef, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { StudyLinks } from "./study-links";
import { BookOpenIcon } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { BoneIcon } from "@phosphor-icons/react/dist/ssr/Bone";
import { PlayIcon } from "@phosphor-icons/react/dist/ssr/Play";
import { PauseIcon } from "@phosphor-icons/react/dist/ssr/Pause";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import { CubeIcon } from "@phosphor-icons/react/dist/ssr/Cube";
import { KeyboardIcon } from "@phosphor-icons/react/dist/ssr/Keyboard";
import { GearSixIcon } from "@phosphor-icons/react/dist/ssr/GearSix";
import type { Study } from "@/lib/studies";
import { ArtCanvas } from "./art-canvas";
import { Brand } from "./brand";

export function StudyPlayer({study}: {study: Study}) {
  const [frame,setFrame] = useState(0);
  const [playing,setPlaying] = useState(false);
  const [rig,setRig] = useState(true);
  const guide = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!playing) return;
    let animation = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const advance = Math.floor((now - previous) * 24 / 1000);
      if (advance) {
        previous += advance * 1000 / 24;
        setFrame(n => (n + advance) % study.frames);
      }
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [playing,study.frames]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (guide.current?.open || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if((e.target as Element)?.closest("button,input,a,select")) return;
      if(e.code === "Space") { e.preventDefault(); setPlaying(v => !v); }
      if(e.key.toLowerCase() === "b") setRig(v => !v);
    };
    window.addEventListener("keydown",key);
    return () => window.removeEventListener("keydown",key);
  }, []);
  return <div className="app-shell">
    <header className="topbar">
      <Brand/><span className="brand-divider"/><span className="studio-name">Motion Studio</span>
      <nav aria-label="Main"><button className="guide-link" onClick={() => guide.current?.showModal()}><BookOpenIcon/> Quick guide</button>
      <UserButton/></nav>
    </header>
    <main className="landing expanded"><div className="hero">
        <section className="viewer" aria-label="Motion study player">
          <div className="viewer-head"><h1 className="viewer-title"><CubeIcon size={17}/> {study.name}</h1><div className="viewer-actions">
            <button aria-pressed={rig} className="rig-toggle" onClick={() => setRig(v => !v)}><BoneIcon size={15}/> Bones</button>
          </div></div>
          <div className="stage" role="img" aria-label={study.name + " articulated character, frame " + (frame+1)}>
            <span className="stage-label"><span className="specimen-dot" style={{background:study.color}}/>{study.name.toUpperCase()}<span className="stage-slash">/</span>{study.clip.toUpperCase()}</span>
            <i className="cross tr"/><i className="cross bl"/><i className="cross br"/>
            <ArtCanvas study={study} frame={frame} rig={rig}/>
          </div>
          <div className="transport">
            <button className="play" aria-label={playing ? "Pause clip" : "Play clip"} onClick={() => setPlaying(v => !v)}>{playing ? <PauseIcon weight="fill"/> : <PlayIcon weight="fill"/>}</button>
            <span className="frame-count">{String(frame+1).padStart(2,"0")} <b>/ {study.frames}</b></span>
            <input aria-label="Frame" type="range" min={1} max={study.frames} value={frame+1} onChange={e => { setPlaying(false); setFrame(Number(e.target.value)-1); }}/>
            <span className="fps">24 FPS</span>
          </div>
        </section>
      </div>
      <StudyLinks active={study.id}/>
    </main>
    <footer className="statusbar"><span><i/> Signed in</span><button onClick={() => guide.current?.showModal()}><KeyboardIcon size={16}/> Keyboard shortcuts</button></footer>
    <dialog ref={guide} className="guide" onClick={e => {if(e.target === guide.current) guide.current.close();}}>
      <div className="guide-inner"><div className="dialog-head"><GearSixIcon size={24}/><button className="icon-button" aria-label="Close guide" onClick={() => guide.current?.close()}><XIcon/></button></div>
      <h2>Quick guide</h2><p>Choose a motion study, then drag the frame slider to inspect its pose. Toggle Bones to see how its joints connect.</p>
      <dl><div><dt>Play or pause</dt><dd><kbd>Space</kbd></dd></div><div><dt>Toggle bones</dt><dd><kbd>B</kbd></dd></div></dl></div>
    </dialog>
  </div>;
}
