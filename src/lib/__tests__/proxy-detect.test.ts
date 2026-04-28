import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Wave 22G regression tests for proxy auto-detect.
 *
 * Three protocol probes race against the same host:port. We mock
 * `net.createConnection` so the test fakes the on-wire bytes for each
 * scenario:
 *   - SOCKS5 server (responds with 0x05 0x00)
 *   - HTTPS proxy (responds with HTTP/1.1 200 OK to CONNECT)
 *   - HTTP proxy (responds with HTTP/1.0 200 OK to absolute-form GET)
 *   - Dead host (timeout / refused on every probe)
 *
 * Pin the priority order: SOCKS5 wins over HTTPS over HTTP when
 * multiple protocols would succeed (rare in practice but the contract
 * matters when admin uses the Probe button).
 */

vi.mock("@/lib/security/public-ip", () => ({
  assertPublicHost: vi.fn(async (h: string) => h),
  SsrfBlockedError: class extends Error {
    reason = "test";
  },
}));

interface MockSocket {
  emit: (ev: string, ...args: unknown[]) => void;
  destroy: () => void;
  write: (b: Buffer | string) => void;
  on: (ev: string, fn: (arg?: unknown) => void) => MockSocket;
  once: (ev: string, fn: (arg?: unknown) => void) => MockSocket;
}

let socketScripts: Array<(s: MockSocket) => void> = [];

vi.mock("net", () => ({
  default: {
    createConnection: vi.fn(() => {
      const handlers: Record<string, Array<(arg?: unknown) => void>> = {};
      const socket: MockSocket = {
        emit: (ev, ...args) => {
          (handlers[ev] ?? []).forEach((h) => h(...(args as [unknown])));
        },
        destroy: vi.fn(),
        write: vi.fn(),
        on: (ev, fn) => {
          (handlers[ev] = handlers[ev] ?? []).push(fn);
          return socket;
        },
        once: (ev, fn) => {
          (handlers[ev] = handlers[ev] ?? []).push(fn);
          return socket;
        },
      };
      // Pop the next script from the queue and apply it asynchronously
      // so the caller has time to attach handlers.
      const script = socketScripts.shift();
      if (script) {
        setImmediate(() => script(socket));
      }
      return socket;
    }),
  },
}));

import { detectProxy } from "@/lib/proxy-detect";

beforeEach(() => {
  socketScripts = [];
});

describe("detectProxy — Wave 22G", () => {
  it("detects SOCKS5 when the first response byte is 0x05", async () => {
    // 3 probes fire in parallel. Order in which createConnection is
    // called: socks5, https, http (in that source order).
    // SOCKS5 succeeds; HTTPS + HTTP both fail.
    socketScripts.push((s) => {
      s.emit("connect");
      // SOCKS5 server replies with version 5, accepted no-auth.
      s.emit("data", Buffer.from([0x05, 0x00]));
    });
    socketScripts.push((s) => {
      s.emit("connect");
      s.emit("data", Buffer.from("garbage", "ascii"));
    });
    socketScripts.push((s) => {
      s.emit("connect");
      s.emit("data", Buffer.from("garbage", "ascii"));
    });

    const result = await detectProxy("203.0.113.1", 1080);
    expect(result.alive).toBe(true);
    expect(result.type).toBe("socks5");
    expect(result.probes.socks5.ok).toBe(true);
  });

  it("detects HTTPS proxy when CONNECT receives HTTP/1.1 200", async () => {
    socketScripts.push((s) => {
      s.emit("connect");
      // SOCKS5 probe — non-SOCKS5 reply (HTTP-style server).
      s.emit("data", Buffer.from("HTTP/1.1 400 Bad Request\r\n", "ascii"));
    });
    socketScripts.push((s) => {
      s.emit("connect");
      s.emit("data", Buffer.from("HTTP/1.1 200 OK\r\n", "ascii"));
    });
    socketScripts.push((s) => {
      s.emit("connect");
      s.emit("data", Buffer.from("HTTP/1.1 200 OK\r\n", "ascii"));
    });

    const result = await detectProxy("203.0.113.1", 8080);
    expect(result.alive).toBe(true);
    // HTTPS wins over HTTP because of priority order in detectProxy.
    expect(result.type).toBe("https");
  });

  it("detects HTTP plain proxy when CONNECT fails but absolute-form GET works", async () => {
    socketScripts.push((s) => {
      s.emit("connect");
      s.emit("data", Buffer.from([0x00, 0x00]));  // SOCKS5: bad version byte
    });
    socketScripts.push((s) => {
      s.emit("connect");
      // HTTPS probe (CONNECT) — no proper HTTP/1.x reply.
      s.emit("data", Buffer.from("503 Service Unavailable", "ascii"));
    });
    socketScripts.push((s) => {
      s.emit("connect");
      // Plain HTTP proxy responds to absolute-form GET.
      s.emit("data", Buffer.from("HTTP/1.0 200 OK\r\n", "ascii"));
    });

    const result = await detectProxy("203.0.113.1", 3128);
    expect(result.alive).toBe(true);
    expect(result.type).toBe("http");
  });

  it("returns alive=false + type=null when all 3 probes fail", async () => {
    for (let i = 0; i < 3; i++) {
      socketScripts.push((s) => {
        s.emit("error", new Error("ECONNREFUSED"));
      });
    }
    const result = await detectProxy("203.0.113.99", 9999);
    expect(result.alive).toBe(false);
    expect(result.type).toBeNull();
  });

  it("returns SOCKS5 even when reply is 0x05 0xff (no acceptable methods)", async () => {
    // RFC 1928: 0xff means server understands SOCKS5 but rejects all
    // proposed auth methods. STILL proves it's a SOCKS5 server.
    socketScripts.push((s) => {
      s.emit("connect");
      s.emit("data", Buffer.from([0x05, 0xff]));
    });
    socketScripts.push((s) => {
      s.emit("error", new Error("nope"));
    });
    socketScripts.push((s) => {
      s.emit("error", new Error("nope"));
    });

    const result = await detectProxy("203.0.113.1", 1080);
    expect(result.type).toBe("socks5");
  });
});
