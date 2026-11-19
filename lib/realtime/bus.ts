import { Redis } from "@upstash/redis";
import { presenceSchema, roomEventSchema, type RevisionEvent, type RoomEvent, type RoomPresence } from "./protocol";
import type { KinetixRigState } from "../rig/model";

const prefix = "kinetix:v1:rig:";
const names = (id: string) => ({
  channel:prefix + "{" + id + "}:events",
  presence:prefix + "{" + id + "}:presence",
  state:prefix + "{" + id + "}:state",
});

export interface RoomBus {
  mark(id: string, entry: RoomPresence): Promise<void>;
  recent(id: string): Promise<RoomPresence[]>;
  revision(id: string): Promise<number>;
  changed(id: string, event: RevisionEvent, state: KinetixRigState): Promise<void>;
  timeline(id: string, clipId: string): Promise<void>;
  revoke(id: string, userId: string): Promise<void>;
  subscribe(id: string, receive: (event: RoomEvent) => void, onError: () => void): () => void;
}

export class RedisRooms implements RoomBus {
  constructor(private readonly redis: Redis) {}

  async mark(id: string, entry: RoomPresence) {
    const room = names(id);
    const key = entry.userId + ":" + entry.clientId;
    await this.redis.multi().hset(room.presence,{[key]:entry}).expire(room.presence,90)
      .publish(room.channel,JSON.stringify({type:"presence",entry})).exec();
  }

  async recent(id: string) {
    const room = names(id);
    const entries = await this.redis.hgetall<Record<string,unknown>>(room.presence);
    const now = Date.now();
    const visible: RoomPresence[] = [];
    for (const raw of Object.values(entries ?? {})) {
      const parsed = presenceSchema.safeParse(raw);
      if (parsed.success && parsed.data.expiresAt > now) visible.push(parsed.data);
    }
    return visible;
  }

  async revision(id: string) {
    const revision = await this.redis.hget<number>(names(id).state,"revision");
    return Number.isSafeInteger(revision) ? revision! : 0;
  }

  async changed(id: string, event: RevisionEvent, state: KinetixRigState) {
    const room = names(id);
    const document = JSON.stringify(state);
    const cached = Buffer.byteLength(document) <= 256 * 1024 ? document : "";
    await this.redis.eval(`
      local previous = redis.call("HGET", KEYS[1], "revision")
      if not previous or tonumber(previous) < tonumber(ARGV[1]) then
        redis.call("HSET", KEYS[1], "revision", ARGV[1], "document", ARGV[2])
        redis.call("EXPIRE", KEYS[1], 120)
      end
      return redis.call("PUBLISH", KEYS[2], ARGV[3])
    `, [room.state,room.channel], [event.revision,cached,JSON.stringify(event)]);
  }

  async revoke(id: string, userId: string) {
    const room = names(id);
    await this.redis.eval(`
      for _, field in ipairs(redis.call("HKEYS", KEYS[1])) do
        if string.sub(field, 1, string.len(ARGV[1])) == ARGV[1] then
          redis.call("HDEL", KEYS[1], field)
        end
      end
      return redis.call("PUBLISH", KEYS[2], ARGV[2])
    `, [room.presence,room.channel], [userId + ":",JSON.stringify({type:"revoke",userId})]);
  }

  async timeline(id: string, clipId: string) {
    await this.redis.publish(names(id).channel,JSON.stringify({type:"timeline",clipId}));
  }

  subscribe(id: string, receive: (event: RoomEvent) => void, onError: () => void) {
    const subscriber = this.redis.subscribe<unknown>(names(id).channel);
    subscriber.on("message",({message}) => {
      const event = roomEventSchema.safeParse(message);
      if (event.success) receive(event.data);
    });
    subscriber.on("error",onError);
    return () => {
      subscriber.removeAllListeners();
      void subscriber.unsubscribe().catch(() => {});
    };
  }
}

let roomBus: RoomBus | undefined;
export function rooms(): RoomBus {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Real-time rooms require Upstash.");
  return roomBus ??= new RedisRooms(new Redis({url,token}));
}
