"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowUpRight";
import { BookOpenIcon } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { BoneIcon } from "@phosphor-icons/react/dist/ssr/Bone";
import { CornersOutIcon } from "@phosphor-icons/react/dist/ssr/CornersOut";
import { CornersInIcon } from "@phosphor-icons/react/dist/ssr/CornersIn";
import { PlayIcon } from "@phosphor-icons/react/dist/ssr/Play";
import { PauseIcon } from "@phosphor-icons/react/dist/ssr/Pause";
import { StackIcon } from "@phosphor-icons/react/dist/ssr/Stack";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import { CubeIcon } from "@phosphor-icons/react/dist/ssr/Cube";
import { WaveformIcon } from "@phosphor-icons/react/dist/ssr/Waveform";
import { KeyboardIcon } from "@phosphor-icons/react/dist/ssr/Keyboard";
import { GearSixIcon } from "@phosphor-icons/react/dist/ssr/GearSix";
import { studies } from "@/lib/studies";
import { ArtCanvas } from "./art-canvas";
import { Brand } from "./brand";

export function Playground({initialDemo}: {initialDemo: boolean}) {
  const [index,setIndex] = useState(0);
  const [frame,setFrame] = useState(0);
  const [playing,setPlaying] = useState(false);
  const [rig,setRig] = useState(true);
  const [expanded,setExpanded] = useState(initialDemo);
  const guide = useRef<HTMLDialogElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const launchButton = useRef<HTMLButtonElement>(null);
  const study = studies[index];
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
      if(e.key === "Escape" && expanded) { setExpanded(false); requestAnimationFrame(() => launchButton.current?.focus()); return; }
      if((e.target as Element)?.closest("button,input,a,select")) return;
      if(e.code === "Space") { e.preventDefault(); setPlaying(v => !v); }
      if(e.key.toLowerCase() === "b") setRig(v => !v);
    };
    window.addEventListener("keydown",key);
    return () => window.removeEventListener("keydown",key);
  }, [expanded]);
  function launch() {
    setExpanded(true);
    requestAnimationFrame(() => expandButton.current?.focus());
  }
  function selectStudy(i: number) { setIndex(i); setFrame(0); }
  return <div className="app-shell">
    <header className="topbar">
      <Brand/><span className="brand-divider"/><span className="studio-name">Motion Studio</span>
      <nav aria-label="Main"><button className="guide-link" onClick={() => guide.current?.showModal()}><BookOpenIcon/> Quick guide</button>
      <Link className="signin" href="/sign-in">Sign in <ArrowUpRightIcon/></Link></nav>
    </header>
    <main className={"landing" + (expanded ? " expanded" : "")}>
      <div className="hero">
        <section className="intro">
          <p className="eyebrow"><span className="signal"/> 2D ANIMATION STUDIO</p>
          <h1>Make it<br/><em>move.</em></h1>
          <p className="lede">A motion playground for humans and AI. Explore character rigs, inspect bones, and play with timing.</p>
          <button ref={launchButton} className="primary" onClick={launch}>Launch playground <ArrowRightIcon size={19}/></button>
        </section>
        <section className="viewer" aria-label="Interactive rig preview">
          <div className="viewer-head"><span className="viewer-title"><CubeIcon size={17}/> Rig preview</span><div className="viewer-actions">
            <button aria-pressed={rig} className="rig-toggle" onClick={() => setRig(v => !v)}><BoneIcon size={15}/> Bones</button>
            <button ref={expandButton} className="icon-button expand-control" aria-label={expanded ? "Close playground" : "Expand preview"} onClick={() => setExpanded(v => !v)}>{expanded ? <CornersInIcon/> : <CornersOutIcon/>}</button>
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
      <section className="library" aria-label="Motion studies">
        <div className="library-head"><h2><StackIcon size={22}/> Motion studies</h2><span>SELECT A RIG</span></div>
        <div className="study-list">{studies.map((item,i) =>
          <button key={item.id} className={"study" + (i===index ? " selected" : "")} aria-pressed={i===index} onClick={() => selectStudy(i)}>
            <span className="thumb" style={{backgroundColor:item.wash}}><ArtCanvas study={item} mini/></span>
            <span className="study-text"><strong>{item.name}</strong><small>{item.clip}</small></span>
            <span className="study-arrow">{i===index ? <WaveformIcon size={18}/> : <ArrowUpRightIcon size={17}/>}</span>
          </button>)}</div>
      </section>
    </main>
    <footer className="statusbar"><span><i/> Guest playground</span><button onClick={() => guide.current?.showModal()}><KeyboardIcon size={16}/> Keyboard shortcuts</button></footer>
    <dialog ref={guide} className="guide" onClick={e => {if(e.target === guide.current) guide.current.close();}}>
      <div className="guide-inner"><div className="dialog-head"><GearSixIcon size={24}/><button className="icon-button" aria-label="Close guide" onClick={() => guide.current?.close()}><XIcon/></button></div>
      <h2>Quick guide</h2><p>Choose a motion study, then drag the frame slider to inspect its pose. Toggle Bones to see how its joints connect.</p>
      <dl><div><dt>Play or pause</dt><dd><kbd>Space</kbd></dd></div><div><dt>Toggle bones</dt><dd><kbd>B</kbd></dd></div><div><dt>Exit expanded view</dt><dd><kbd>Esc</kbd></dd></div></dl></div>
    </dialog>
  </div>;
}
