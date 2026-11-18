import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { clerkEnabled } from "./config";
import type { Services } from "./api";

// Anonymous playback is client-side. Unconfigured demos share one bounded bucket per instance.
export function demoWindow(now = Date.now, max = 120, duration = 60_000) {
  let hits: number[] = [];
  return () => {
    const time = now();
    hits = hits.filter(hit => hit > time - duration);
    const success = hits.length < max;
    if (success) hits.push(time);
    return { success, reset: (hits[0] ?? time) + duration };
  };
}
const local = demoWindow();
let distributed: Ratelimit | undefined;
export const services: Services = {
  identify: async (c, next) => {
    c.set("userId", null);
    if (!clerkEnabled()) return next();
    const verify = clerkMiddleware({
      secretKey: process.env.CLERK_SECRET_KEY!,
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!,
      authorizedParties: [new URL(c.req.url).origin]
    });
    return verify(c, async () => {
      c.set("userId", getAuth(c)?.userId ?? null);
      await next();
    });
  },
  clientKey: req => process.env.VERCEL === "1"
    ? req.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() || "anonymous"
    : "local",
  limit: async key => {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (process.env.KINETIX_DEMO_ONLY === "1") return local();
    if (!url && !token && !clerkEnabled()) return local();
    if (!url || !token) throw new Error("Account mode requires a distributed limiter.");
    distributed ??= new Ratelimit({
      redis: new Redis({ url, token }), limiter: Ratelimit.slidingWindow(120, "1 m"),
      prefix: "kinetix:v1", timeout: 0
    });
    return distributed.limit(key);
  }
};
