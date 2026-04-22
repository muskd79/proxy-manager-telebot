import { describe, it, expect, vi, beforeEach } from "vitest";
import { vendorFetch } from "../http";
import { VendorAuthError, VendorRateLimitError, VendorError } from "../errors";

describe("vendorFetch", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status,
      headers: {
        get: (k: string) => headers[k.toLowerCase()] ?? null,
      },
      text: () => Promise.resolve(JSON.stringify(body)),
    }) as unknown as typeof fetch;
  }

  it("returns parsed JSON on 200", async () => {
    mockFetch(200, { hello: "world" });
    const res = await vendorFetch<{ hello: string }>("test", "http://example.com/ok");
    expect(res.ok).toBe(true);
    expect(res.data.hello).toBe("world");
  });

  it("throws VendorAuthError on 401", async () => {
    mockFetch(401, { error: "bad token" });
    await expect(vendorFetch("test", "http://x/")).rejects.toThrow(VendorAuthError);
  });

  it("throws VendorAuthError on 403", async () => {
    mockFetch(403, { error: "forbidden" });
    await expect(vendorFetch("test", "http://x/")).rejects.toThrow(VendorAuthError);
  });

  it("throws VendorRateLimitError on 429 with retry-after header", async () => {
    mockFetch(429, { error: "slow down" }, { "retry-after": "30" });
    try {
      await vendorFetch("test", "http://x/");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VendorRateLimitError);
      expect((err as VendorRateLimitError).retryAfterMs).toBe(30_000);
    }
  });

  it("throws invalid_request for 4xx without specific mapping", async () => {
    mockFetch(422, { error: "bad input" });
    try {
      await vendorFetch("test", "http://x/");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VendorError);
      expect((err as VendorError).code).toBe("invalid_request");
      expect((err as VendorError).statusCode).toBe(422);
    }
  });

  it("throws vendor_error on 5xx", async () => {
    mockFetch(503, { error: "down" });
    try {
      await vendorFetch("test", "http://x/");
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as VendorError).code).toBe("vendor_error");
    }
  });

  it("throws not_found on 404", async () => {
    mockFetch(404, null);
    try {
      await vendorFetch("test", "http://x/");
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as VendorError).code).toBe("not_found");
    }
  });

  it("wraps abort errors with timeout code", async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    }) as unknown as typeof fetch;
    try {
      await vendorFetch("test", "http://x/", { timeoutMs: 1 });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as VendorError).code).toBe("timeout");
    }
  });
});

// vitest's `afterEach` comes from the import; add explicit import if eslint flags it.
import { afterEach } from "vitest";
