import Phaser from "phaser";
import { frameAtTick, openSpriteBundle, restoreSpritePixels, type PlaybackClip, type PlaybackFrame } from "../../lib/export/sprite-playback";
import { compileSpriteTimeline, spriteCuesBetween } from "./timeline";

export const phaserSpriteProfile = { id: "kinetix.phaser.sprites", version: 1, phaser: "3.90.0", bundle: 2 } as const;

type FrameTexture = { key: string; x: number; y: number };
type ImportedClip = {
  data: PlaybackClip;
  pixelScale: number;
  frames: Map<string, FrameTexture>;
  timeline: ReturnType<typeof compileSpriteTimeline>;
};

const maxPreparedPixels = 16 * 1024 * 1024;

/** Give trimmed and untrimmed layouts the same transparent edge when sampling. */
function makeFrameTexture(crop: ReturnType<typeof restoreSpritePixels> | undefined) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  if (!crop) return { canvas, x: 0, y: 0 };

  const { width, height, pixels } = crop;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pixels[(y * width + x) * 4 + 3]) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) return { canvas, x: 0, y: 0 };

  const cropWidth = right - left + 1;
  canvas.width = cropWidth + 2;
  canvas.height = bottom - top + 3;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Phaser could not prepare a sprite texture canvas.");
  const guarded = context.createImageData(canvas.width, canvas.height);
  for (let y = top; y <= bottom; y++) {
    const from = (y * width + left) * 4;
    const to = ((y - top + 1) * canvas.width + 1) * 4;
    guarded.data.set(pixels.subarray(from, from + cropWidth * 4), to);
  }
  context.putImageData(guarded, 0, 0);
  return { canvas, x: left - 1, y: top - 1 };
}

function textureIdentity(frame: PlaybackFrame) {
  if (frame.blank) return "blank";
  const { x, y, width, height } = frame.rect;
  return JSON.stringify([frame.file, x, y, width, height, frame.rotation]);
}

/** Owns the published textures for one rig in one Phaser scene. */
export class KinetixPhaserLibrary {
  private readonly texturePrefix = `kinetix-${Phaser.Utils.String.UUID()}`;
  private readonly players = new Set<KinetixPhaserSprite>();
  private readonly ownedTextures = new Set<string>();
  private clips = new Map<string, ImportedClip>();
  private sourceId?: string;
  private lastDigest?: string;
  private nextTexture = 0;
  private active = true;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  listClips() {
    return [...this.clips.values()].map(({ data }) => ({
      id: data.id, name: data.name, direction: data.direction, ticksPerSecond: data.ticksPerSecond,
      loopMode: data.loopMode, durationTicks: data.durationTicks,
    }));
  }

  /** Serialize imports so two uploads cannot publish in the opposite order. */
  importBundle(bytes: Uint8Array) {
    const input = Uint8Array.from(bytes);
    const next = this.queue.then(() => this.publishBundle(input));
    this.queue = next.catch(() => undefined);
    return next;
  }

  createSprite(x: number, y: number, clipId: string) {
    const sprite = new KinetixPhaserSprite(this.scene, x, y, this.requireClip(clipId), id => this.requireClip(id));
    this.scene.add.existing(sprite);
    this.players.add(sprite);
    sprite.once(Phaser.GameObjects.Events.DESTROY, () => this.players.delete(sprite));
    return sprite;
  }

  destroy() {
    if (!this.active) return;
    this.active = false;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    for (const sprite of [...this.players]) sprite.destroy();
    this.releaseTextures(this.ownedTextures);
    this.clips.clear();
  }

  private requireClip(id: string) {
    const clip = this.clips.get(id);
    if (!clip) throw new Error(`No Kinetix clip with source ID ${id} has been imported.`);
    return clip;
  }

  private releaseTextures(keys: Iterable<string>) {
    for (const key of keys) {
      this.scene.textures.remove(key);
      this.ownedTextures.delete(key);
    }
  }

  private async publishBundle(bytes: Uint8Array<ArrayBuffer>) {
    if (!this.active) throw new Error("The Phaser sprite library is closed.");
    const { manifest, textures } = await openSpriteBundle(bytes);
    if (this.sourceId && this.sourceId !== manifest.source.rigId) {
      throw new Error("This bundle belongs to a different Kinetix project. Create a separate library to import it.");
    }
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const packageHash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
    if (!this.active) throw new Error("The Phaser sprite library is closed.");

    const incoming = new Set(manifest.clips.map(({ id }) => id));
    const kept = [...this.clips].filter(([id]) => !incoming.has(id));
    const receipt = {
      profile: phaserSpriteProfile, rigId: manifest.source.rigId, revision: manifest.source.revision,
      packageHash, layout: manifest.layout, clipIds: [...incoming], keptClipIds: kept.map(([id]) => id),
    };
    if (this.lastDigest === packageHash) return receipt;

    const unique = new Map<string, PlaybackFrame>();
    for (const clip of manifest.clips) {
      for (const frame of clip.frames) unique.set(textureIdentity(frame), frame);
    }
    const retainedKeys = new Set(kept.flatMap(([, clip]) => [...clip.frames.values()].map(frame => frame.key)));
    let totalPixels = [...retainedKeys].reduce((size, key) => {
      const frame = this.scene.textures.getFrame(key);
      return size + frame.width * frame.height;
    }, 0);

    const stagedTextures = new Map<string, FrameTexture>();
    const updated = new Map(kept);
    try {
      for (const [identity, frame] of unique) {
        const key = `${this.texturePrefix}-${this.nextTexture++}`;
        const crop = frame.blank ? undefined : restoreSpritePixels(textures.get(frame.file)!, frame, manifest.texture);
        const { canvas, x, y } = makeFrameTexture(crop);
        totalPixels += canvas.width * canvas.height;
        if (totalPixels > maxPreparedPixels) {
          throw new Error("The restored Phaser textures exceed 16 megapixels. Import fewer clips or use a smaller export scale.");
        }
        const renderer = this.scene.game.renderer;
        if ("getMaxTextureSize" in renderer && Math.max(canvas.width, canvas.height) > renderer.getMaxTextureSize()) {
          throw new Error("A sprite exceeds this Phaser renderer's maximum texture size. Export at a smaller scale.");
        }
        const texture = this.scene.textures.addCanvas(key, canvas);
        if (!texture) throw new Error("Phaser could not register a sprite texture.");
        stagedTextures.set(identity, { key, x, y });
        texture.setFilter(manifest.texture.filter === "nearest" ? Phaser.Textures.FilterMode.NEAREST : Phaser.Textures.FilterMode.LINEAR);
      }
      for (const clip of manifest.clips) {
        updated.set(clip.id, {
          data: clip, pixelScale: manifest.source.pixelScale, timeline: compileSpriteTimeline(clip),
          frames: new Map(clip.frames.map(frame => [frame.id, stagedTextures.get(textureIdentity(frame))!])),
        });
      }
    } catch (error) {
      this.releaseTextures([...stagedTextures.values()].map(frame => frame.key));
      throw error;
    }

    this.clips = updated;
    this.sourceId = manifest.source.rigId;
    this.lastDigest = packageHash;
    for (const sprite of this.players) {
      if (incoming.has(sprite.clipId)) sprite.refreshClip();
    }
    this.releaseTextures([...this.ownedTextures].filter(key => !retainedKeys.has(key)));
    for (const { key } of stagedTextures.values()) this.ownedTextures.add(key);
    return receipt;
  }
}

/** Use the container as the stable game object, with its transform at the authored pivot. */
export class KinetixPhaserSprite extends Phaser.GameObjects.Container {
  private readonly art: Phaser.GameObjects.Image;
  private renderedFrame?: PlaybackFrame;
  private tick = 0;
  private cueCursor = -1;
  private playbackRevision = 0;
  private playing = true;

  constructor(scene: Phaser.Scene, x: number, y: number, private clip: ImportedClip, private readonly findClip: (id: string) => ImportedClip) {
    super(scene, x, y);
    this.art = new Phaser.GameObjects.Image(scene, 0, 0, clip.frames.get(clip.data.frames[0].id)!.key).setOrigin(0);
    this.add(this.art);
    this.renderFrame();
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.updatePlayback, this);
    this.once(Phaser.GameObjects.Events.DESTROY, () => scene.events.off(Phaser.Scenes.Events.UPDATE, this.updatePlayback, this));
  }

  get clipId() { return this.clip.data.id; }
  get currentFrame() { return frameAtTick(this.clip.data, this.tick); }
  get artboardSize() {
    const { width, height } = this.currentFrame.sourceSize;
    return { width: width / this.clip.pixelScale, height: height / this.clip.pixelScale };
  }

  playClip(clipId: string) {
    this.clip = this.findClip(clipId);
    this.seek(0);
    this.cueCursor = -1;
    this.playing = true;
    return this;
  }

  setPlaying(playing: boolean) {
    this.playing = playing;
    return this;
  }

  /** Seek without delivering cues. Advance manually while paused to replay deterministically. */
  seek(tick: number) {
    if (!Number.isSafeInteger(tick) || tick < 0) throw new Error("Seek requires a non-negative integer tick.");
    this.tick = tick;
    this.cueCursor = tick;
    this.playbackRevision++;
    this.renderFrame();
    return this;
  }

  advanceTicks(ticks: number) {
    if (!Number.isFinite(ticks) || ticks < 0 || ticks > 10_000) throw new Error("Advance requires 0–10,000 ticks per update.");
    const end = Math.min(this.tick + ticks, this.clip.timeline.repeats ? Infinity : this.clip.timeline.period - 1);
    const revision = ++this.playbackRevision;
    for (const { tick, event } of spriteCuesBetween(this.clip.timeline, this.cueCursor, Math.floor(end))) {
      this.tick = tick;
      this.renderFrame();
      this.cueCursor = tick;
      this.emit("kinetix-cue", structuredClone(event));
      if (this.playbackRevision !== revision || !this.scene) return this;
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
    this.cueCursor = Math.floor(this.tick);
    this.playbackRevision++;
    this.renderFrame();
  }

  private localPoint(point: { x: number; y: number }, frame: PlaybackFrame) {
    return { x: (point.x - frame.pivot.x) / this.clip.pixelScale, y: (point.y - frame.pivot.y) / this.clip.pixelScale };
  }

  private updatePlayback(_time: number, delta: number) {
    if (this.active && this.playing) this.advanceTicks(delta * this.clip.data.ticksPerSecond / 1000);
  }

  private renderFrame() {
    const frame = this.currentFrame;
    if (frame === this.renderedFrame) return;
    const texture = this.clip.frames.get(frame.id)!;
    const scale = 1 / this.clip.pixelScale;
    const x = (frame.trimOffset.x + texture.x - frame.pivot.x) * scale;
    const y = (frame.trimOffset.y + texture.y - frame.pivot.y) * scale;
    this.art.setTexture(texture.key).setPosition(x, y).setScale(scale).setVisible(!frame.blank);
    this.renderedFrame = frame;
  }
}
