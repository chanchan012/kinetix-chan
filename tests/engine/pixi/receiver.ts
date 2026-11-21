import { Application, Graphics, VERSION, type RendererPreference } from "pixi.js";
import { KinetixPixiLibrary, type KinetixPixiSprite } from "../../../integrations/pixi/kinetix-sprites";
import type { SpriteCue } from "../../../lib/export/sprite-playback";

type TestReceiver = {
  app: Application;
  version: string;
  library: KinetixPixiLibrary;
  actor?: KinetixPixiSprite;
  cues: SpriteCue[];
  createProp(): Graphics;
  importBytes(bytes: number[], expectedBase?: string | null): ReturnType<KinetixPixiLibrary["importBundle"]>;
};

declare global {
  interface Window { pixiReceiver: TestReceiver; pixiInitError?: string }
}

async function start() {
  const type = new URLSearchParams(location.search).get("renderer") as RendererPreference;
  const app = new Application();
  await app.init({ preference: [type], width: 128, height: 96, backgroundAlpha: 0, autoStart: false });
  document.body.appendChild(app.canvas);
  const library = new KinetixPixiLibrary(app);
  const cues: SpriteCue[] = [];
  window.pixiReceiver = {
    app, library, cues, version: VERSION,
    createProp: () => new Graphics().circle(12, 18, 2).fill(0xff9900),
    async importBytes(bytes, expectedBase) {
      const receipt = await library.importBundle(Uint8Array.from(bytes), expectedBase);
      if (!this.actor) {
        this.actor = library.createSprite(receipt.clipIds[0]).setPlaying(false);
        this.actor.position.set(72, 56);
        this.actor.scale.set(1.25);
        this.actor.on("kinetix-cue", (cue: SpriteCue) => cues.push(cue));
        app.stage.addChild(this.actor);
      }
      app.render();
      return receipt;
    },
  };
}

void start().catch(error => { window.pixiInitError = String(error); });
