import { Application, CanvasSource, Container, Sprite, Texture, VERSION, type DestroyOptions, type Ticker } from "pixi.js";
import {
  compileSpriteTimeline, createSpriteCanvas, frameAtTick, openSpriteBundle, restoreSpritePixels,
  spriteCropIdentity, spriteCuesBetween, type PlaybackClip, type PlaybackFrame,
} from "../../lib/export/sprite-playback";

export const pixiSpriteProfile = { id: "kinetix.pixi.sprites", version: 1, pixi: VERSION, bundle: 2 } as const;

type FrameTexture = { texture: Texture; x: number; y: number };
type LoadedClip = {
  data: PlaybackClip;
  pixelScale: number;
  frames: Map<string, FrameTexture>;
  timeline: ReturnType<typeof compileSpriteTimeline>;
};

function clipSummary({ id, name, direction, ticksPerSecond, loopMode, durationTicks }: PlaybackClip) {
  return { id, name, direction, ticksPerSecond, loopMode, durationTicks };
}

/** Owns the textures for one Kinetix project. Game code owns the actor's parent and transform. */
export class KinetixPixiLibrary {
  private readonly players = new Set<KinetixPixiSprite>();
  private readonly ownedTextures = new Set<Texture>();
  private clips = new Map<string, LoadedClip>();
  private sourceId?: string;
  private packageHash: string | null = null;
  private disposed = false;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly app: Application) {
    app.stage.once("destroyed", this.destroy, this);
  }

  listClips() {
    return [...this.clips.values()].map(clip => clipSummary(clip.data));
  }

  async previewImport(bytes: Uint8Array) {
    return (await this.inspect(Uint8Array.from(bytes))).plan;
  }

  importBundle(bytes: Uint8Array, expectedBase?: string | null) {
    const input = Uint8Array.from(bytes);
    const next = this.pending.then(() => this.publish(input, expectedBase));
    this.pending = next.catch(() => undefined);
    return next;
  }

  createSprite(clipId: string) {
    const actor = new KinetixPixiSprite(this.app, this.requireClip(clipId), id => this.requireClip(id));
    this.players.add(actor);
    actor.once("destroyed", () => this.players.delete(actor));
    return actor;
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.app.stage.off("destroyed", this.destroy, this);
    for (const sprite of this.players) sprite.destroy();
    for (const texture of this.ownedTextures) texture.destroy(true);
    this.ownedTextures.clear();
    this.clips.clear();
  }

  private requireClip(id: string) {
    const clip = this.clips.get(id);
    if (!clip) throw new Error(`No Kinetix clip with source ID ${id} has been imported.`);
    return clip;
  }

  private async inspect(bytes: Uint8Array<ArrayBuffer>) {
    if (this.disposed) throw new Error("The PixiJS sprite library is closed.");
    const { manifest, textures } = await openSpriteBundle(bytes);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    if (this.disposed) throw new Error("The PixiJS sprite library is closed.");
    if (this.sourceId && this.sourceId !== manifest.source.rigId) {
      throw new Error("This bundle belongs to another Kinetix project. Create a separate sprite library for it.");
    }

    const packageHash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
    const identical = packageHash === this.packageHash;
    const incomingIds = new Set(manifest.clips.map(({ id }) => id));
    const retained = [...this.clips].filter(([id]) => !incomingIds.has(id));
    const plan = {
      profile: pixiSpriteProfile,
      rigId: manifest.source.rigId,
      revision: manifest.source.revision,
      layout: manifest.layout,
      packageHash,
      baseHash: this.packageHash,
      identical,
      clipIds: [...incomingIds],
      added: manifest.clips.filter(clip => !this.clips.has(clip.id)).map(clipSummary),
      updated: identical ? [] : manifest.clips.filter(clip => this.clips.has(clip.id)).map(clip => ({
        before: clipSummary(this.requireClip(clip.id).data), after: clipSummary(clip),
      })),
      retained: retained.map(([, clip]) => clipSummary(clip.data)),
    };
    return { manifest, textures, retained, incomingIds, plan };
  }

  private async publish(bytes: Uint8Array<ArrayBuffer>, expectedBase: string | null | undefined) {
    const { manifest, textures, retained, incomingIds, plan } = await this.inspect(bytes);
    if (this.disposed) throw new Error("The PixiJS sprite library is closed.");
    if (plan.identical) return plan;
    if (expectedBase !== undefined && this.packageHash !== expectedBase) {
      throw new Error("The imported project changed while previewing. Open the import preview again.");
    }
    const kept = new Set(retained.flatMap(([, clip]) => [...clip.frames.values()].map(frame => frame.texture)));
    let totalPixels = [...kept].reduce((sum, texture) => sum + texture.source.pixelWidth * texture.source.pixelHeight, 0);
    const staged = new Map<string, FrameTexture>();
    const next = new Map(retained);
    const renderer = this.app.renderer;
    const device = "gpu" in renderer ? renderer.gpu.device : undefined;
    const maxTextureSize = "gl" in renderer ? Number(renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_SIZE)) :
      device?.limits.maxTextureDimension2D ?? 8192;
    device?.pushErrorScope("out-of-memory");
    device?.pushErrorScope("validation");
    let scopesOpen = device !== undefined;
    try {
      for (const clip of manifest.clips) {
        const frames = new Map<string, FrameTexture>();
        for (const frame of clip.frames) {
          const key = spriteCropIdentity(frame);
          let asset = staged.get(key);
          if (!asset) {
            const crop = frame.blank ? undefined : restoreSpritePixels(textures.get(frame.file)!, frame, manifest.texture);
            const { canvas, x, y } = createSpriteCanvas(crop);
            totalPixels += canvas.width * canvas.height;
            if (Math.max(canvas.width, canvas.height) > maxTextureSize || totalPixels > 16 * 1024 * 1024) {
              throw new Error("The sprites exceed this PixiJS texture budget. Use a smaller export scale or import fewer clips.");
            }
            const source = new CanvasSource({ resource: canvas, scaleMode: manifest.texture.filter, autoGarbageCollect: false });
            asset = { texture: new Texture({ source }), x, y };
            staged.set(key, asset);
            renderer.texture.initSource(source);
          }
          frames.set(frame.id, asset);
        }
        next.set(clip.id, { data: clip, pixelScale: manifest.source.pixelScale, frames, timeline: compileSpriteTimeline(clip) });
      }
      if (device) {
        scopesOpen = false;
        const [validation, memory] = await Promise.all([device.popErrorScope(), device.popErrorScope()]);
        if (validation || memory) throw new Error("WebGPU could not upload the sprite textures. Try a smaller export scale.");
        if (this.disposed) throw new Error("The PixiJS sprite library is closed.");
      }
    } catch (error) {
      if (device && scopesOpen) await Promise.allSettled([device.popErrorScope(), device.popErrorScope()]);
      for (const { texture } of staged.values()) texture.destroy(true);
      throw error;
    }

    this.clips = next;
    this.sourceId = manifest.source.rigId;
    this.packageHash = plan.packageHash;
    for (const actor of this.players) {
      if (incomingIds.has(actor.clipId)) actor.refreshClip();
    }
    for (const texture of this.ownedTextures) {
      if (kept.has(texture)) continue;
      texture.destroy(true);
      this.ownedTextures.delete(texture);
    }
    for (const { texture } of staged.values()) this.ownedTextures.add(texture);
    return plan;
  }
}

export class KinetixPixiSprite extends Container {
  private readonly art = new Sprite(Texture.EMPTY);
  private renderedFrame?: PlaybackFrame;
  private tick = 0;
  private cueCursor = -1;
  private playbackRevision = 0;
  private playing = true;

  constructor(private readonly app: Application, private clip: LoadedClip, private readonly findClip: (id: string) => LoadedClip) {
    super();
    this.addChild(this.art);
    this.renderFrame();
    app.ticker.add(this.updatePlayback, this);
  }

  get clipId() { return this.clip.data.id; }
  get currentFrame() { return frameAtTick(this.clip.data, this.tick); }
  get artboardSize() {
    const { width, height } = this.currentFrame.sourceSize;
    return { width: width / this.clip.pixelScale, height: height / this.clip.pixelScale };
  }

  playClip(id: string) {
    this.clip = this.findClip(id);
    this.seek(0);
    this.cueCursor = -1;
    this.playing = true;
    return this;
  }

  setPlaying(playing: boolean) {
    this.playing = playing;
    return this;
  }

  seek(tick: number) {
    if (!Number.isSafeInteger(tick) || tick < 0) throw new Error("Seek requires a non-negative integer tick.");
    this.tick = tick;
    this.refreshPosition();
    return this;
  }

  advanceTicks(ticks: number) {
    if (!Number.isFinite(ticks) || ticks < 0 || ticks > 10_000) throw new Error("Advance requires 0–10,000 ticks per update.");
    const end = Math.min(this.tick + ticks, this.clip.timeline.repeats ? Infinity : this.clip.timeline.period - 1);
    const revision = ++this.playbackRevision;
    for (const { tick, event } of spriteCuesBetween(this.clip.timeline, this.cueCursor, Math.floor(end))) {
      this.tick = this.cueCursor = tick;
      this.renderFrame();
      this.emit("kinetix-cue", structuredClone(event));
      if (this.destroyed || this.playbackRevision !== revision) return this;
    }
    this.tick = end;
    this.cueCursor = Math.floor(end);
    this.renderFrame();
    return this;
  }

  socket(name: string) {
    const frame = this.currentFrame;
    const socket = frame.sockets.find(entry => entry.name === name);
    return socket && { ...this.localPoint(socket, frame), angle: socket.angle };
  }

  collisions() {
    const frame = this.currentFrame;
    return frame.collisions.map(shape => shape.kind === "rect" ? {
      kind: shape.kind, name: shape.name, ...this.localPoint(shape, frame),
      width: shape.width / this.clip.pixelScale, height: shape.height / this.clip.pixelScale,
    } : { kind: shape.kind, name: shape.name, points: shape.points.map(point => this.localPoint(point, frame)) });
  }

  refreshClip() {
    this.clip = this.findClip(this.clipId);
    this.refreshPosition();
  }

  override destroy(options?: DestroyOptions) {
    if (this.destroyed) return;
    // Pixi disposes the application ticker before destroying its stage.
    this.app.ticker?.remove(this.updatePlayback, this);
    this.art.destroy();
    super.destroy(options);
  }

  private refreshPosition() {
    this.cueCursor = Math.floor(this.tick);
    this.playbackRevision++;
    this.renderFrame();
  }

  private localPoint(point: { x: number; y: number }, frame: PlaybackFrame) {
    return { x: (point.x - frame.pivot.x) / this.clip.pixelScale, y: (point.y - frame.pivot.y) / this.clip.pixelScale };
  }

  private updatePlayback(ticker: Ticker) {
    if (this.playing) this.advanceTicks(ticker.deltaMS * this.clip.data.ticksPerSecond / 1000);
  }

  private renderFrame() {
    const frame = this.currentFrame;
    if (frame === this.renderedFrame) return;
    const { texture, x, y } = this.clip.frames.get(frame.id)!;
    const scale = 1 / this.clip.pixelScale;
    this.art.texture = texture;
    this.art.position.set((frame.trimOffset.x + x - frame.pivot.x) * scale, (frame.trimOffset.y + y - frame.pivot.y) * scale);
    this.art.scale.set(scale);
    this.art.visible = !frame.blank;
    this.renderedFrame = frame;
  }
}
