import type { Artboard } from "@/lib/rig/model";

export function readArtboardFields(fields: FormData): Artboard {
  return {
    name: String(fields.get("artboardName")),
    width: Number(fields.get("width")),
    height: Number(fields.get("height")),
    background: String(fields.get("background")).trim() || null,
  };
}

export function ArtboardFields({ artboard }: { artboard: Artboard }) {
  return <>
    <label>Artboard name<input name="artboardName" defaultValue={artboard.name} maxLength={120} required/></label>
    <label>Width (px)<input name="width" type="number" min={16} max={4096} defaultValue={artboard.width} required/></label>
    <label>Height (px)<input name="height" type="number" min={16} max={4096} defaultValue={artboard.height} required/></label>
    <label>Background<input name="background" maxLength={7} pattern="#[0-9A-Fa-f]{6}"
      placeholder="Transparent" defaultValue={artboard.background ?? ""}/></label>
  </>;
}
