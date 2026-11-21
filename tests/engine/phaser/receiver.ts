import Phaser from "phaser";
import { KinetixPhaserLibrary, type KinetixPhaserSprite } from "../../../integrations/phaser/kinetix-sprites";
import type { SpriteCue } from "../../../integrations/phaser/timeline";

type TestReceiver = {
  scene: Phaser.Scene;
  version: string;
  renderer: number;
  library: KinetixPhaserLibrary;
  actor?: KinetixPhaserSprite;
  cues: SpriteCue[];
  importBytes(bytes: number[]): Promise<Awaited<ReturnType<KinetixPhaserLibrary["importBundle"]>>>;
};

declare global {
  interface Window { receiver: TestReceiver }
}

class ReceiverScene extends Phaser.Scene {
  create() {
    const library = new KinetixPhaserLibrary(this);
    const cues: SpriteCue[] = [];
    window.receiver = {
      scene: this, library, cues, version: Phaser.VERSION, renderer: this.game.renderer.type,
      async importBytes(bytes) {
        const receipt = await library.importBundle(Uint8Array.from(bytes));
        if (!this.actor) {
          this.actor = library.createSprite(72, 56, receipt.clipIds[0]).setPlaying(false);
          this.actor.on("kinetix-cue", (cue: SpriteCue) => cues.push(cue));
        }
        return receipt;
      },
    };
  }
}

new Phaser.Game({
  type: new URLSearchParams(location.search).has("webgl") ? Phaser.WEBGL : Phaser.CANVAS,
  width: 128, height: 96, transparent: true, banner: false, scene: ReceiverScene,
});
