import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

export type IdentityEnv = { Variables: { userId: string | null } };
export type LimitResult = { success: boolean; reset: number };
export interface Services {
  identify: MiddlewareHandler<IdentityEnv>;
  limit: (key: string) => Promise<LimitResult>;
  clientKey: (request: Request) => string;
}
export const sessionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("guest"), canSave: z.literal(false) }),
  z.object({ mode: z.literal("member"), userId: z.string().min(1), canSave: z.literal(true) })
]);
export function createApi(services: Services) {
  return new Hono<IdentityEnv>().basePath("/api")
    .use("*", async (c, next) => {
      c.header("Cache-Control", "private, no-store");
      try {
        const decision = await services.limit(services.clientKey(c.req.raw));
        if (!decision.success) {
          c.header("Retry-After", String(Math.max(1, Math.ceil((decision.reset - Date.now()) / 1000))));
          return c.json({ error: "rate_limited" }, 429);
        }
      } catch {
        return c.json({ error: "limiter_unavailable" }, 503);
      }
      await next();
    })
    .get("/health", c => c.json({ service: "kinetix", status: "ok" } as const))
    .use("*", services.identify)
    .get("/session", c => {
      const userId = c.get("userId");
      return c.json(sessionSchema.parse(userId ? { mode: "member", userId, canSave: true } : { mode: "guest", canSave: false }));
    })
    .get("/account", c => {
      const userId = c.get("userId");
      return userId ? c.json({ userId }, 200) : c.json({ error: "authentication_required" }, 401);
    });
}
export type AppType = ReturnType<typeof createApi>;
