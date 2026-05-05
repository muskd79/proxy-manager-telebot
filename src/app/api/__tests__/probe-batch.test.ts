import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireAdminOrAbove = vi.fn();
const mockDetectProxy = vi.fn();
const mockCreateClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...actual, requireAdminOrAbove: (...args: unknown[]) => mockRequireAdminOrAbove(...args) };
});

vi.mock("@/lib/proxy-detect", () => ({
  detectProxy: (...args: unknown[]) => mockDetectProxy(...args),
}));

import { POST } from "@/app/api/proxies/probe-batch/route";

function makeRequest(body: unknown): import("next/server").NextRequest {
  return new Request("http://localhost/api/proxies/probe-batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

type DR = import("@/lib/proxy-detect").ProxyDetectResult;
const blankProbes = () => ({
  socks5: { ok: false, speed_ms: 0 },
  https: { ok: false, speed_ms: 0 },
  http: { ok: false, speed_ms: 0 },
});
const ALIVE_HTTP: DR = {
  alive: true, type: "http", speed_ms: 100,
  probes: { socks5: { ok: false, speed_ms: 0 }, https: { ok: false, speed_ms: 0 }, http: { ok: true, speed_ms: 100 } },
};
const DEAD: DR = { alive: false, type: null, speed_ms: 0, probes: blankProbes() };
const SSRF_BLOCKED: DR = {
  alive: false, type: null, speed_ms: 0, ssrf_blocked: true, ssrf_reason: "private IP",
  probes: {
    socks5: { ok: false, speed_ms: 0, reason: "ssrf_blocked" },
    https: { ok: false, speed_ms: 0, reason: "ssrf_blocked" },
    http: { ok: false, speed_ms: 0, reason: "ssrf_blocked" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateClient.mockResolvedValue({});
  mockRequireAdminOrAbove.mockResolvedValue({ error: null });
  mockDetectProxy.mockResolvedValue(ALIVE_HTTP);
});

describe("POST /api/proxies/probe-batch - auth", () => {
  it("returns auth error when not authorized", async () => {
    mockRequireAdminOrAbove.mockResolvedValueOnce({
      error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    const res = await POST(makeRequest({ proxies: [{ host: "1.2.3.4", port: 8080 }] }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/proxies/probe-batch - validation", () => {
  it("rejects empty proxies array", async () => {
    const res = await POST(makeRequest({ proxies: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Validation failed/i);
  });

  it("rejects more than 1000 rows", async () => {
    const proxies = Array.from({ length: 1001 }, (_, i) => ({ host: "1.2.3.4", port: 8000 + (i % 60000) }));
    const res = await POST(makeRequest({ proxies }));
    expect(res.status).toBe(400);
  });

  it("accepts exactly 1 row", async () => {
    const res = await POST(makeRequest({ proxies: [{ host: "1.2.3.4", port: 8080 }] }));
    expect(res.status).toBe(200);
  });

  it("rejects missing proxies field", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/proxies/probe-batch - concurrency", () => {
  it("calls detectProxy once per row for a 60-row batch", async () => {
    const proxies = Array.from({ length: 60 }, (_, i) => ({ host: "1.2.3.4", port: 8000 + i }));
    const res = await POST(makeRequest({ proxies }));
    expect(res.status).toBe(200);
    expect(mockDetectProxy).toHaveBeenCalledTimes(60);
  });

  it("results array matches input length", async () => {
    const proxies = [{ host: "1.2.3.4", port: 8080 }, { host: "1.2.3.5", port: 8081 }];
    const res = await POST(makeRequest({ proxies }));
    const body = await res.json();
    expect(body.data.results).toHaveLength(2);
  });
});

describe("POST /api/proxies/probe-batch - summary", () => {
  it("returns correct total/alive/dead/by_type", async () => {
    const socks5R: DR = {
      alive: true, type: "socks5", speed_ms: 50,
      probes: { socks5: { ok: true, speed_ms: 50 }, https: { ok: false, speed_ms: 0 }, http: { ok: false, speed_ms: 0 } },
    };
    const httpsR: DR = {
      alive: true, type: "https", speed_ms: 80,
      probes: { socks5: { ok: false, speed_ms: 0 }, https: { ok: true, speed_ms: 80 }, http: { ok: false, speed_ms: 0 } },
    };
    mockDetectProxy
      .mockResolvedValueOnce(ALIVE_HTTP)
      .mockResolvedValueOnce(socks5R)
      .mockResolvedValueOnce(httpsR)
      .mockResolvedValueOnce(DEAD);
    const proxies = [
      { host: "1.1.1.1", port: 80 }, { host: "2.2.2.2", port: 1080 },
      { host: "3.3.3.3", port: 443 }, { host: "4.4.4.4", port: 9999 },
    ];
    const res = await POST(makeRequest({ proxies }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.summary).toMatchObject({ total: 4, alive: 3, dead: 1 });
    expect(body.data.summary.by_type.http).toBe(1);
    expect(body.data.summary.by_type.socks5).toBe(1);
    expect(body.data.summary.by_type.https).toBe(1);
  });
});

describe("POST /api/proxies/probe-batch - ref", () => {
  it("echoes ref tag through to result row", async () => {
    const proxies = [{ host: "1.2.3.4", port: 8080, ref: "row-42" }];
    const res = await POST(makeRequest({ proxies }));
    const body = await res.json();
    expect(body.data.results[0].ref).toBe("row-42");
    expect(body.data.results[0].host).toBe("1.2.3.4");
  });
});

describe("POST /api/proxies/probe-batch - SSRF", () => {
  // Wave 28-F [HIGH, audit #4] — private IPs now rejected at Zod
  // parse time (publicHostLiteral refine) so the request never
  // reaches detectProxy() and can't leak a timing-oracle speed_ms.
  // The previous "200 with ssrf_blocked=true" wire shape was
  // unreachable for obvious literals; retained the runtime
  // ssrf_blocked path inside detectProxy() for hosts that pass the
  // literal check but resolve to a private IP at DNS time.

  it("rejects private IP at parse time with 400 — no detectProxy call", async () => {
    mockDetectProxy.mockResolvedValueOnce(SSRF_BLOCKED);
    const res = await POST(
      makeRequest({ proxies: [{ host: "192.168.1.1", port: 8080, ref: "priv" }] }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    // detectProxy must NOT have been called — that's the point of
    // the fix (no timing-oracle leak via speed_ms).
    expect(mockDetectProxy).not.toHaveBeenCalled();
  });

  it("rejects RFC 1918 10.x.x.x at parse time", async () => {
    const res = await POST(
      makeRequest({ proxies: [{ host: "10.0.0.1", port: 3128 }] }),
    );
    expect(res.status).toBe(400);
    expect(mockDetectProxy).not.toHaveBeenCalled();
  });

  it("rejects loopback 127.0.0.1 at parse time", async () => {
    const res = await POST(
      makeRequest({ proxies: [{ host: "127.0.0.1", port: 80 }] }),
    );
    expect(res.status).toBe(400);
    expect(mockDetectProxy).not.toHaveBeenCalled();
  });

  it("rejects link-local 169.254.169.254 (cloud metadata) at parse time", async () => {
    const res = await POST(
      makeRequest({ proxies: [{ host: "169.254.169.254", port: 80 }] }),
    );
    expect(res.status).toBe(400);
    expect(mockDetectProxy).not.toHaveBeenCalled();
  });

  it("zeroes speed_ms when detectProxy returns ssrf_blocked (defence-in-depth)", async () => {
    mockDetectProxy.mockResolvedValueOnce({
      ...SSRF_BLOCKED,
      speed_ms: 999, // pretend the runtime path leaked a non-zero value
    });
    // Use a public-looking host that resolves to a private IP at DNS
    // time — passes Zod refine, runtime SSRF still kicks in.
    const res = await POST(
      makeRequest({ proxies: [{ host: "203.0.113.99", port: 8080 }] }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.results[0].ssrf_blocked).toBe(true);
    // The route's defence-in-depth zero-out kicks in even if
    // detectProxy returned a non-zero speed_ms.
    expect(body.data.results[0].speed_ms).toBe(0);
  });
});
