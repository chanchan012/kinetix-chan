import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { libraryApi } from "./library-api";
import { Library } from "../db/library";
import { connectDatabase } from "../db/client";

export type IdentityEnv = { Variables: { userId: string | null } };
export type LimitResult = { success: boolean; reset: number };
export interface Services {
  identify: MiddlewareHandler<IdentityEnv>;
  limit: (key: string) => Promise<LimitResult>;
  clientKey: (request: Request) => string;
}
export const sessionSchema = z.object({ mode: z.literal("member"), userId: z.string().min(1), canSave: z.literal(true) });
export function createApi(services: Services, repository = () => new Library(connectDatabase())) {
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
      return userId ? c.json(sessionSchema.parse({ mode: "member", userId, canSave: true })) : c.json({ error: "authentication_required" }, 401);
    })
    .get("/account", c => {
      const userId = c.get("userId");
      return userId ? c.json({ userId }, 200) : c.json({ error: "authentication_required" }, 401);
    }).route("/rigs",libraryApi(repository));
}
export type AppType = ReturnType<typeof createApi>;
