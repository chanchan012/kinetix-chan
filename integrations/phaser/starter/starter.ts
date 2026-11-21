import Phaser from "phaser";
import { KinetixPhaserLibrary, type KinetixPhaserSprite } from "../kinetix-sprites";
import type { SpriteCue } from "../timeline";

const input = document.querySelector<HTMLInputElement>("#bundle")!;
const clipSelect = document.querySelector<HTMLSelectElement>("#clip")!;
const transport = document.querySelector<HTMLButtonElement>("#transport")!;
const status = document.querySelector<HTMLParagraphElement>("#message")!;
const cueLabel = document.querySelector<HTMLElement>("#cue")!;
const revision = document.querySelector<HTMLElement>("#revision")!;

class StarterScene extends Phaser.Scene {
  private library!: KinetixPhaserLibrary;
  private sprite?: KinetixPhaserSprite;
  private marker!: Phaser.GameObjects.Arc;
  private playing = true;

  create() {
    this.library = new KinetixPhaserLibrary(this);
    this.add.line(240, 172, -320, 0, 320, 0, 0x53675a);
    this.marker = this.add.circle(0, 0, 3, 0xd6ef81).setVisible(false).setDepth(2);
    input.onchange = () => void this.loadExport();
    clipSelect.onchange = () => {
      this.sprite?.playClip(clipSelect.value).setPlaying(this.playing);
      cueLabel.textContent = "None";
    };
    transport.onclick = () => {
      this.playing = !this.playing;
      this.sprite?.setPlaying(this.playing);
      transport.textContent = this.playing ? "Pause" : "Play";
    };
  }

  update() {
    const socket = this.sprite?.currentFrame.sockets[0];
    const local = socket && this.sprite?.socket(socket.name);
    if (!local || !this.sprite) {
      this.marker.setVisible(false);
      return;
    }
    const world = this.sprite.getWorldTransformMatrix().transformPoint(local.x, local.y);
    this.marker.setPosition(world.x, world.y).setVisible(true);
  }

  private async loadExport() {
    const file = input.files?.[0];
    if (!file) return;
    input.disabled = true;
    try {
      const receipt = await this.library.importBundle(new Uint8Array(await file.arrayBuffer()));
      const clips = this.library.listClips();
      const selected = this.sprite?.clipId ?? clips[0].id;
      clipSelect.replaceChildren(...clips.map(clip => new Option(
        clip.direction ? `${clip.name} · ${clip.direction}` : clip.name, clip.id,
      )));
      clipSelect.value = selected;
      if (!this.sprite) {
        this.sprite = this.library.createSprite(240, 172, selected);
        const { width, height } = this.sprite.artboardSize;
        this.sprite.setScale(Math.min(8, 190 / Math.max(width, height)));
        this.sprite.on("kinetix-cue", ({ cue }: SpriteCue) => { cueLabel.textContent = cue.name; });
      }
      revision.textContent = String(receipt.revision);
      status.textContent = `Imported ${receipt.clipIds.length} clip${receipt.clipIds.length === 1 ? "" : "s"} from ${receipt.layout}.` +
        (receipt.keptClipIds.length ? ` Kept ${receipt.keptClipIds.length} omitted clip${receipt.keptClipIds.length === 1 ? "" : "s"}.` : "");
      transport.disabled = clipSelect.disabled = false;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "The bundle could not be opened.";
    } finally {
      input.disabled = false;
      input.value = "";
    }
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 480,
  height: 280,
  backgroundColor: "#202a25",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: StarterScene,
});
