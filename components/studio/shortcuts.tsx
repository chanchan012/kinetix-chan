"use client";

import { useEffect, useEffectEvent } from "react";
import { Dialog } from "../dialog";

export function useStudioShortcuts(handle: (event: KeyboardEvent) => void) {
  const onKey = useEffectEvent(handle);
  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || document.querySelector("dialog[open]")) return;
      if (event.target instanceof HTMLElement &&
          (event.target.isContentEditable || event.target.closest("input, textarea, select, [role=separator]"))) return;
      onKey(event);
    }
    document.addEventListener("keydown", keyDown);
    return () => document.removeEventListener("keydown", keyDown);
  }, []);
}

const shortcuts = [
  ["Select / Draw bone / Pen", "V / B / P"],
  ["Finish path / Close shape", "Enter / Shift + Enter"],
  ["Cancel tool or stroke setup", "Esc"],
  ["Toggle bones / Onion skin", "H / O"],
  ["Play or pause", "Space"],
  ["Step one frame / Step five frames", "← or → / Shift + ← or →"],
  ["Insert keyframe", "K"],
  ["Zoom in / Zoom out / Fit", "+ / − / 0"],
  ["Save rig", "Ctrl or ⌘ + S"],
  ["Undo / Redo", "Ctrl or ⌘ + Z / Ctrl or ⌘ + Shift + Z"],
  ["Resize focused separator", "Arrow keys / Shift + arrow keys"],
  ["Keyboard shortcuts", "?"],
] as const;

export function ShortcutsDialog({close}: {close: () => void}) {
  return <Dialog title="Keyboard shortcuts" className="studio-easing studio-shortcuts" onClose={close}>
    <dl>{shortcuts.map(([label, keys]) => <div key={label}><dt>{label}</dt><dd><kbd>{keys}</kbd></dd></div>)}</dl>
  </Dialog>;
}
