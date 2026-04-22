import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assertSameOrigin, sanitizeLogLine } from "../csrf";

function mkReq(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/x", { method: "POST", headers });
}

describe("assertSameOrigin", () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    APP_ORIGIN_ALLOWLIST: process.env.APP_ORIGIN_ALLOWLIST,
  };

  beforeEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "https://proxy-manager.example.com";
    delete process.env.APP_ORIGIN_ALLOWLIST;
  });

  afterEach(() => {
    if (originalEnv.NODE_ENV !== undefined)
      (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv.NODE_ENV;
    if (originalEnv.NEXT_PUBLIC_APP_URL !== undefined)
      process.env.NEXT_PUBLIC_APP_URL = originalEnv.NEXT_PUBLIC_APP_URL;
    if (originalEnv.APP_ORIGIN_ALLOWLIST !== undefined)
      process.env.APP_ORIGIN_ALLOWLIST = originalEnv.APP_ORIGIN_ALLOWLIST;
  });

  it("allows matching Origin", () => {
    const res = assertSameOrigin(
      mkReq({ origin: "https://proxy-manager.example.com" }),
    );
    expect(res).toBeNull();
  });

  it("rejects a different Origin with 403", async () => {
    const res = assertSameOrigin(mkReq({ origin: "https://evil.com" }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json();
    expect(body.error).toMatch(/Cross-origin/);
  });

  it("falls back to Referer prefix match when Origin missing", () => {
    const res = assertSameOrigin(
      mkReq({ referer: "https://proxy-manager.example.com/vendors" }),
    );
    expect(res).toBeNull();
  });

  it("rejects when Origin absent and Referer also non-matching", () => {
    const res = assertSameOrigin(
      mkReq({ referer: "https://evil.com/phish" }),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("rejects when neither Origin nor Referer present", () => {
    const res = assertSameOrigin(mkReq({}));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("honors APP_ORIGIN_ALLOWLIST comma list", () => {
    process.env.APP_ORIGIN_ALLOWLIST =
      "https://a.example.com, https://b.example.com";
    expect(assertSameOrigin(mkReq({ origin: "https://a.example.com" }))).toBeNull();
    expect(assertSameOrigin(mkReq({ origin: "https://b.example.com" }))).toBeNull();
    expect(assertSameOrigin(mkReq({ origin: "https://c.example.com" }))).not.toBeNull();
  });

  it("allows localhost outside production", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    expect(assertSameOrigin(mkReq({ origin: "http://localhost:3000" }))).toBeNull();
  });

  it("does NOT allow localhost in production", () => {
    expect(assertSameOrigin(mkReq({ origin: "http://localhost:3000" }))).not.toBeNull();
  });
});

describe("sanitizeLogLine", () => {
  it("strips CR/LF/TAB", () => {
    expect(sanitizeLogLine("hello\nworld")).toBe("hello world");
    expect(sanitizeLogLine("a\rb\tc")).toBe("a b c");
  });

  it("caps at 1024 chars", () => {
    const long = "x".repeat(2000);
    expect(sanitizeLogLine(long).length).toBe(1024);
  });

  it("passes clean strings through", () => {
    expect(sanitizeLogLine("hello world")).toBe("hello world");
  });
});
