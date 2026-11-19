import { describe, expect, it, vi, afterEach } from "vitest";
import { hc } from "hono/client";
import { createApi, type AppType, type Services } from "../../lib/api";
import { services } from "../../lib/services";

function fixture(overrides: Partial<Services> = {}) {
  return createApi({
    identify: async (c, next) => { c.set("userId", null); await next(); },
    clientKey: () => "test",
    limit: async () => ({ success: true, reset: Date.now()+60000 }),
    ...overrides
  });
}
afterEach(() => vi.unstubAllEnvs());
describe("Hono RPC", () => {
  it("exposes the health contract through a typed RPC client", async () => {
    const app = fixture();
    const client = hc<AppType>("http://localhost", { fetch: app.request.bind(app) });
    expect(await (await client.api.health.$get()).json()).toEqual({ service:"kinetix", status:"ok" });
  });
  it("rejects unverified identity headers", async () => {
    const app = fixture();
    const r = await app.request("/api/session",{headers:{"X-User-Id":"user_123"}});
    expect(r.status).toBe(401);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });
  it("uses the identity supplied by the verification middleware", async () => {
    const app = fixture({ identify:async(c,next) => { c.set("userId","user_verified");await next(); } });
    expect(await (await app.request("/api/session")).json()).toEqual({ mode:"member",userId:"user_verified",canSave:true });
    expect(await (await app.request("/api/account")).json()).toEqual({ userId:"user_verified" });
  });
  it("fails closed when Clerk is unconfigured", async () => {
    vi.stubEnv("CLERK_SECRET_KEY","");
    expect((await fixture({identify:services.identify}).request("/api/session")).status).toBe(503);
  });
  it("rejects anonymous account access through the actual Clerk middleware", async () => {

    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY","pk_test_" + Buffer.from("fixture.clerk.accounts.dev$").toString("base64"));
    vi.stubEnv("CLERK_SECRET_KEY","sk_test_fixture");
    const app = fixture({identify:services.identify});
    expect((await app.request("/api/account")).status).toBe(401);
  });
  it("requires shared rate limiting when accounts are enabled", async () => {
     vi.stubEnv("CLERK_SECRET_KEY","sk_test_fixture");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY","pk_test_fixture");
    vi.stubEnv("UPSTASH_REDIS_REST_URL",""); vi.stubEnv("UPSTASH_REDIS_REST_TOKEN","");
    expect((await fixture({limit:services.limit}).request("/api/session")).status).toBe(503);
  });
  it("returns retry information before running authentication", async () => {
    const identify = vi.fn();
    const app = fixture({identify,limit:async() => ({success:false,reset:Date.now()+2000})});
    const r = await app.request("/api/account");
    expect(r.status).toBe(429); expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(identify).not.toHaveBeenCalled();
  });
  it("fails closed when the distributed limiter is unavailable", async () => {
    const app = fixture({limit: async () => { throw Error("redis unavailable"); }});
    expect((await app.request("/api/session")).status).toBe(503);
  });
  it("rate-limits presence posts and event subscriptions before authentication", async () => {
    const identify = vi.fn();
    const app = fixture({identify,limit:async()=>({success:false,reset:Date.now()+1000})});
    const base = "/api/rigs/04f2a718-ffe2-4153-8ce4-f6682e89e7a3";
    expect((await app.request(base+"/events")).status).toBe(429);
    expect((await app.request(base+"/presence",{method:"POST"})).status).toBe(429);
    expect(identify).not.toHaveBeenCalled();
  });
});
