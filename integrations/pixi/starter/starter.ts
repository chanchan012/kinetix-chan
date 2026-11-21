import { Application, Graphics } from "pixi.js";
import { KinetixPixiLibrary, type KinetixPixiSprite } from "../kinetix-sprites";
import type { SpriteCue } from "../../../lib/export/sprite-playback";

const input = document.querySelector<HTMLInputElement>("#bundle")!;
const clips = document.querySelector<HTMLSelectElement>("#clip")!;
const transport = document.querySelector<HTMLButtonElement>("#transport")!;
const stage = document.querySelector<HTMLDivElement>("#game")!;
const status = document.querySelector<HTMLParagraphElement>("#message")!;
const panel = document.querySelector<HTMLElement>("#plan")!;
const list = document.querySelector<HTMLUListElement>("#changes")!;
const apply = document.querySelector<HTMLButtonElement>("#apply")!;
const cancel = document.querySelector<HTMLButtonElement>("#cancel")!;
const cueLabel = document.querySelector<HTMLElement>("#cue")!;
const revision = document.querySelector<HTMLElement>("#revision")!;

const describeClip = (clip: { name: string; direction?: string }) =>
  clip.direction ? `${clip.name} · ${clip.direction}` : clip.name;

async function start() {
  const app = new Application();
  await app.init({ preference: ["webgl", "canvas"], resizeTo: stage, background: "#202f29" });
  stage.append(app.canvas);
  const library = new KinetixPixiLibrary(app);
  const marker = new Graphics().circle(0, 0, 3).fill(0xcefa8a);
  let actor: KinetixPixiSprite | undefined;
  let playing = true;
  let pending: { bytes: Uint8Array; baseHash: string | null } | undefined;
  input.disabled = false;
  status.textContent = "Choose a version 2 sprite ZIP exported by Kinetix.";

  const report = (error: unknown) => {
    status.textContent = error instanceof Error ? error.message : "The bundle could not be opened.";
  };
  const clearPreview = () => {
    pending = undefined;
    panel.hidden = true;
    list.replaceChildren();
  };
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    clearPreview();
    input.disabled = true;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const plan = await library.previewImport(bytes);
      if (plan.identical) {
        status.textContent = `Revision ${plan.revision} is already imported.`;
        return;
      }
      const changes = [
        ...plan.added.map(clip => `Add ${describeClip(clip)}`),
        ...plan.updated.map(({ before, after }) => before.name === after.name && before.direction === after.direction
          ? `Update ${describeClip(after)}` : `Update ${describeClip(before)} to ${describeClip(after)}`),
        ...plan.retained.map(clip => `Keep ${describeClip(clip)}`),
      ];
      list.replaceChildren(...changes.map(text => Object.assign(document.createElement("li"), { textContent: text })));
      pending = { bytes, baseHash: plan.baseHash };
      status.textContent = `Ready to import revision ${plan.revision} from ${plan.layout}.`;
      panel.hidden = false;
    } catch (error) {
      report(error);
    } finally {
      input.disabled = false;
      input.value = "";
    }
  };
  apply.onclick = async () => {
    if (!pending) return;
    const { bytes, baseHash } = pending;
    clearPreview();
    input.disabled = true;
    try {
      const receipt = await library.importBundle(bytes, baseHash);
      const selected = actor?.clipId ?? receipt.clipIds[0];
      clips.replaceChildren(...library.listClips().map(clip => new Option(describeClip(clip), clip.id)));
      clips.value = selected;
      if (!actor) {
        actor = library.createSprite(selected);
        actor.on("kinetix-cue", ({ cue }: SpriteCue) => { cueLabel.textContent = cue.name; });
        app.stage.addChild(actor, marker);
      }
      revision.textContent = String(receipt.revision);
      status.textContent = `Imported ${receipt.clipIds.length} clip${receipt.clipIds.length === 1 ? "" : "s"} from ${receipt.layout}.`;
      clips.disabled = transport.disabled = false;
    } catch (error) {
      report(error);
    } finally {
      input.disabled = false;
    }
  };
  cancel.onclick = () => {
    clearPreview();
    status.textContent = "Import canceled.";
  };
  clips.onchange = () => {
    actor?.playClip(clips.value).setPlaying(playing);
    cueLabel.textContent = "None";
  };
  transport.onclick = () => {
    playing = !playing;
    actor?.setPlaying(playing);
    transport.textContent = playing ? "Pause" : "Play";
  };
  app.ticker.add(() => {
    if (!actor) return;
    const { width, height } = actor.artboardSize;
    actor.position.set(app.screen.width / 2, app.screen.height * 0.58);
    actor.scale.set(Math.min(8, app.screen.width * 0.7 / width, app.screen.height * 0.7 / height));
    const socket = actor.currentFrame.sockets[0];
    const point = socket && actor.socket(socket.name);
    marker.visible = !!point;
    if (point) marker.position.copyFrom(actor.toGlobal(point));
  });
}

void start().catch(error => { status.textContent = error instanceof Error ? error.message : "Could not start PixiJS."; });
