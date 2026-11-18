import { describe, expect, it, vi, afterEach } from "vitest";
import { hc } from "hono/client";
import { createApi, type AppType, type Services } from "../../lib/api";
import { services, demoWindow } from "../../lib/services";
import { clerkEnabled } from "../../lib/config";

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
  it("keeps anonymous sessions read-only even with forged identity headers", async () => {
    vi.stubEnv("KINETIX_DEMO_ONLY","1");
    const app = fixture({ identify: services.identify });
    const headers = { Authorization:"Bearer fake", "X-User-Id":"user_123" };
    const r = await app.request("/api/session",{ headers });
    expect(await r.json()).toEqual({ mode:"guest",canSave:false });
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect((await app.request("/api/account",{ headers })).status).toBe(401);
  });
  it("uses the identity supplied by the verification middleware", async () => {
    const app = fixture({ identify:async(c,next) => { c.set("userId","user_verified");await next(); } });
    expect(await (await app.request("/api/session")).json()).toEqual({ mode:"member",userId:"user_verified",canSave:true });
    expect(await (await app.request("/api/account")).json()).toEqual({ userId:"user_verified" });
  });
  it("rejects a partial Clerk configuration", () => {
    vi.stubEnv("KINETIX_DEMO_ONLY",""); vi.stubEnv("CLERK_SECRET_KEY","");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY","pk_test");
    expect(() => clerkEnabled()).toThrow("both Clerk keys");
  });
  it("rejects anonymous account access through the actual Clerk middleware", async () => {
    vi.stubEnv("KINETIX_DEMO_ONLY","");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY","pk_test_" + Buffer.from("fixture.clerk.accounts.dev$").toString("base64"));
    vi.stubEnv("CLERK_SECRET_KEY","sk_test_fixture");
    const app = fixture({identify:services.identify});
    expect((await app.request("/api/account")).status).toBe(401);
  });
  it("requires shared rate limiting when accounts are enabled", async () => {
    vi.stubEnv("KINETIX_DEMO_ONLY",""); vi.stubEnv("CLERK_SECRET_KEY","sk_test_fixture");
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
  it("expires demo requests at the sliding window boundary", () => {
    let time = 0;
    const attempt = demoWindow(() => time,2,1000);
    expect(attempt().success).toBe(true); time=100; expect(attempt().success).toBe(true);
    time=999; expect(attempt().success).toBe(false);
    time=1000; expect(attempt().success).toBe(true); expect(attempt().success).toBe(false);
  });
});
