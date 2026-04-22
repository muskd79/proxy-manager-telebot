import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rateLimitTake } from "../client";

describe("rateLimitTake", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    RL_WORKER_URL: process.env.RL_WORKER_URL,
    RL_SHARED_SECRET: process.env.RL_SHARED_SECRET,
    RL_KEY_ID: process.env.RL_KEY_ID,
  };

  beforeEach(() => {
    process.env.RL_WORKER_URL = "https://rate-limiter.test.workers.dev";
    process.env.RL_SHARED_SECRET = "a".repeat(64);
    process.env.RL_KEY_ID = "primary";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const k of Object.keys(originalEnv) as Array<keyof typeof originalEnv>) {
      const v = originalEnv[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.restoreAllMocks();
  });

  it("fail-open when RL_WORKER_URL is unset", async () => {
    delete process.env.RL_WORKER_URL;
    const res = await rateLimitTake({ vendorSlug: "webshare" });
    expect(res.allowed).toBe(true);
    if (res.allowed) expect(res.failedOpen).toBe(true);
  });

  it("fail-open when RL_SHARED_SECRET is unset", async () => {
    delete process.env.RL_SHARED_SECRET;
    const res = await rateLimitTake({ vendorSlug: "webshare" });
    expect(res.allowed).toBe(true);
  });

  it("returns allowed=true on 200 response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ tokensLeft: 42, allowed: true, retryAfterMs: 0 }),
    }) as unknown as typeof fetch;

    const res = await rateLimitTake({ vendorSlug: "webshare" });
    expect(res.allowed).toBe(true);
    if (res.allowed) expect(res.tokensLeft).toBe(42);
  });

  it("returns allowed=false on 429 with retryAfterMs", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 429,
      json: async () => ({ tokensLeft: 0, allowed: false, retryAfterMs: 5000 }),
    }) as unknown as typeof fetch;

    const res = await rateLimitTake({ vendorSlug: "webshare" });
    expect(res.allowed).toBe(false);
    if (!res.allowed) expect(res.retryAfterMs).toBe(5000);
  });

  it("fails open on 401 (misconfigured auth)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 401,
      text: async () => "unauthorized",
    }) as unknown as typeof fetch;

    const res = await rateLimitTake({ vendorSlug: "webshare" });
    expect(res.allowed).toBe(true);
    if (res.allowed) expect(res.failedOpen).toBe(true);
  });

  it("fails open on 4xx client error other than 429", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 400,
      text: async () => JSON.stringify({ error: "bad_key" }),
    }) as unknown as typeof fetch;

    const res = await rateLimitTake({ vendorSlug: "webshare" });
    expect(res.allowed).toBe(true);
    if (res.allowed) expect(res.failedOpen).toBe(true);
  });

  it("retries on 5xx and eventually fails open after 4 attempts", async () => {
    const mock = vi.fn().mockResolvedValue({
      status: 503,
      text: async () => "server down",
    });
    globalThis.fetch = mock as unknown as typeof fetch;

    const res = await rateLimitTake({ vendorSlug: "webshare" });
    // 1 initial + 3 retries = 4 total
    expect(mock).toHaveBeenCalledTimes(4);
    expect(res.allowed).toBe(true);
    if (res.allowed) expect(res.failedOpen).toBe(true);
  }, 10_000);

  it("fails open on network error", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ENETUNREACH")) as unknown as typeof fetch;
    const res = await rateLimitTake({ vendorSlug: "webshare" });
    expect(res.allowed).toBe(true);
    if (res.allowed) expect(res.failedOpen).toBe(true);
  }, 10_000);

  it("sends X-RL-Signature and X-RL-Key-Id headers", async () => {
    let observedHeaders: Record<string, string> = {};
    globalThis.fetch = vi
      .fn()
      .mockImplementation(async (_url: string, init: RequestInit) => {
        observedHeaders = init.headers as Record<string, string>;
        return {
          status: 200,
          json: async () => ({ tokensLeft: 10, allowed: true, retryAfterMs: 0 }),
        } as unknown as Response;
      }) as unknown as typeof fetch;

    await rateLimitTake({ vendorSlug: "webshare" });
    expect(observedHeaders["x-rl-key-id"]).toBe("primary");
    expect(observedHeaders["x-rl-signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });
});
