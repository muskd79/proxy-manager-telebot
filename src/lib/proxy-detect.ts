import net from "net";
import { assertPublicHost, SsrfBlockedError } from "@/lib/security/public-ip";

/**
 * Wave 22G — proxy auto-detect.
 *
 * Probes a host:port to figure out (a) whether anything answers,
 * (b) what protocol it speaks, (c) round-trip speed.
 *
 * Algorithm: race three concurrent probes (SOCKS5 handshake, HTTP
 * CONNECT, plain HTTP GET) against the same host. First positive
 * response wins. SSRF-guarded via assertPublicHost (mirrors
 * proxy-checker.ts).
 *
 * Why race instead of sequential? At 5s timeout per probe, sequential
 * worst-case is 15s if proxy is slow; racing keeps total wall-clock
 * at ~5s while still trying every protocol.
 *
 * SOCKS5 detection (RFC 1928):
 *   Send: 05 01 00          (ver=5, 1 method, 0 = no-auth)
 *   Recv: 05 00              (ver=5, accepted no-auth)
 *   Anything else means it's NOT SOCKS5.
 *
 * HTTPS proxy (HTTP CONNECT method, RFC 7231 §4.3.6):
 *   Send: CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n
 *   Recv: HTTP/1.x 200 ...   (any 2xx — tunnel established)
 *   4xx/5xx = it understood CONNECT but rejected. Still HTTPS-proxy.
 *
 * HTTP plain proxy:
 *   Send: GET http://example.com/ HTTP/1.0\r\n\r\n
 *   Recv: any HTTP/1.x line
 *
 * The probes don't pass auth credentials — auth-required proxies
 * still respond (with 407) to the protocol handshake, so we can
 * detect them. Caller can re-probe with creds if needed.
 */

export type DetectedProxyType = "http" | "https" | "socks5";

export interface ProxyDetectResult {
  alive: boolean;
  /** Detected protocol; null if all probes failed. */
  type: DetectedProxyType | null;
  /** Round-trip ms of the FIRST successful probe, or 0 if all failed. */
  speed_ms: number;
  /** SSRF-blocked flag (e.g. private IP). */
  ssrf_blocked?: boolean;
  ssrf_reason?: string;
  /** Per-protocol probe results for debug display. */
  probes: {
    socks5: ProbeOutcome;
    https: ProbeOutcome;
    http: ProbeOutcome;
  };
}

export interface ProbeOutcome {
  ok: boolean;
  speed_ms: number;
  reason?: string;
}

const PROBE_TIMEOUT_MS = 5_000;

export async function detectProxy(
  host: string,
  port: number,
): Promise<ProxyDetectResult> {
  // SSRF guard — same pattern as proxy-checker.ts.
  let pinnedIp: string;
  try {
    pinnedIp = await assertPublicHost(host);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return {
        alive: false,
        type: null,
        speed_ms: 0,
        ssrf_blocked: true,
        ssrf_reason: err.reason,
        probes: blankProbes(),
      };
    }
    return {
      alive: false,
      type: null,
      speed_ms: 0,
      probes: blankProbes(),
    };
  }

  const start = Date.now();

  const [socks5, https, http] = await Promise.all([
    probeSocks5(pinnedIp, port),
    probeHttpsProxy(pinnedIp, port),
    probeHttpProxy(pinnedIp, port),
  ]);

  // Pick the FIRST successful probe in priority order. SOCKS5 first
  // because its handshake is most distinctive (any non-SOCKS5 server
  // responds with garbage that we reject); HTTPS-proxy beats plain
  // HTTP because supporting CONNECT is a strict superset.
  const winner: { type: DetectedProxyType; probe: ProbeOutcome } | null = socks5.ok
    ? { type: "socks5", probe: socks5 }
    : https.ok
      ? { type: "https", probe: https }
      : http.ok
        ? { type: "http", probe: http }
        : null;

  return {
    alive: winner !== null,
    type: winner?.type ?? null,
    speed_ms: winner?.probe.speed_ms ?? Date.now() - start,
    probes: { socks5, https, http },
  };
}

function blankProbes(): ProxyDetectResult["probes"] {
  return {
    socks5: { ok: false, speed_ms: 0, reason: "ssrf_blocked" },
    https: { ok: false, speed_ms: 0, reason: "ssrf_blocked" },
    http: { ok: false, speed_ms: 0, reason: "ssrf_blocked" },
  };
}

// ------------------------------------------------------------
// Per-protocol probes
// ------------------------------------------------------------

function probeSocks5(host: string, port: number): Promise<ProbeOutcome> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.createConnection({ host, port, timeout: PROBE_TIMEOUT_MS });
    let settled = false;
    const finish = (outcome: ProbeOutcome) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(outcome);
    };

    socket.on("connect", () => {
      // RFC 1928 method-negotiation: ver=5, n=1 method, method 0=no-auth.
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });

    socket.once("data", (buf) => {
      // Expect 0x05 0x00 (ver 5, accepted no-auth) or 0x05 0xff (no acceptable).
      // Both shapes prove SOCKS5 — only the version byte matters.
      if (buf.length >= 2 && buf[0] === 0x05) {
        finish({ ok: true, speed_ms: Date.now() - start });
      } else {
        finish({
          ok: false,
          speed_ms: Date.now() - start,
          reason: "non-socks5 response",
        });
      }
    });

    socket.on("timeout", () =>
      finish({ ok: false, speed_ms: PROBE_TIMEOUT_MS, reason: "timeout" }),
    );
    socket.on("error", (e) =>
      finish({ ok: false, speed_ms: Date.now() - start, reason: e.message }),
    );
    socket.on("close", () => {
      if (!settled) {
        finish({
          ok: false,
          speed_ms: Date.now() - start,
          reason: "closed before reply",
        });
      }
    });
  });
}

function probeHttpsProxy(host: string, port: number): Promise<ProbeOutcome> {
  // CONNECT to a stable, neutral host:port. Cloudflare's 1.1.1.1:443 is
  // reliable, has no captive-portal redirects, and won't blacklist us.
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.createConnection({ host, port, timeout: PROBE_TIMEOUT_MS });
    let settled = false;
    const finish = (outcome: ProbeOutcome) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(outcome);
    };

    socket.on("connect", () => {
      socket.write(
        "CONNECT 1.1.1.1:443 HTTP/1.1\r\nHost: 1.1.1.1:443\r\n\r\n",
      );
    });

    socket.once("data", (buf) => {
      const head = buf.subarray(0, Math.min(64, buf.length)).toString("ascii");
      // ANY HTTP/1.x line proves it speaks HTTP-proxy. 200 = tunnel
      // established; 407 = auth required (still HTTPS proxy); 403 =
      // proxy understood request but blocked target. All count as
      // "this is an HTTPS proxy".
      if (/^HTTP\/1\.[01] \d{3}/.test(head)) {
        finish({ ok: true, speed_ms: Date.now() - start });
      } else {
        finish({
          ok: false,
          speed_ms: Date.now() - start,
          reason: "non-http reply",
        });
      }
    });

    socket.on("timeout", () =>
      finish({ ok: false, speed_ms: PROBE_TIMEOUT_MS, reason: "timeout" }),
    );
    socket.on("error", (e) =>
      finish({ ok: false, speed_ms: Date.now() - start, reason: e.message }),
    );
    socket.on("close", () => {
      if (!settled) {
        finish({
          ok: false,
          speed_ms: Date.now() - start,
          reason: "closed before reply",
        });
      }
    });
  });
}

function probeHttpProxy(host: string, port: number): Promise<ProbeOutcome> {
  // Plain HTTP proxy: send absolute-form GET. If the server forwards
  // it (proxy semantics) we get an HTTP/1.x reply. If it's a SOCKS5
  // server, the binary handshake bytes confuse it and the connection
  // either closes or hangs.
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.createConnection({ host, port, timeout: PROBE_TIMEOUT_MS });
    let settled = false;
    const finish = (outcome: ProbeOutcome) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(outcome);
    };

    socket.on("connect", () => {
      // GET to 1.1.1.1 absolute-form — only proxies handle absolute URI.
      socket.write(
        "GET http://1.1.1.1/ HTTP/1.0\r\nHost: 1.1.1.1\r\nUser-Agent: proxy-detect\r\n\r\n",
      );
    });

    socket.once("data", (buf) => {
      const head = buf.subarray(0, Math.min(64, buf.length)).toString("ascii");
      if (/^HTTP\/1\.[01] \d{3}/.test(head)) {
        finish({ ok: true, speed_ms: Date.now() - start });
      } else {
        finish({
          ok: false,
          speed_ms: Date.now() - start,
          reason: "non-http reply",
        });
      }
    });

    socket.on("timeout", () =>
      finish({ ok: false, speed_ms: PROBE_TIMEOUT_MS, reason: "timeout" }),
    );
    socket.on("error", (e) =>
      finish({ ok: false, speed_ms: Date.now() - start, reason: e.message }),
    );
    socket.on("close", () => {
      if (!settled) {
        finish({
          ok: false,
          speed_ms: Date.now() - start,
          reason: "closed before reply",
        });
      }
    });
  });
}

// ------------------------------------------------------------
// GeoIP — DELIBERATELY OMITTED.
// ------------------------------------------------------------
// Wave 22H privacy decision: do NOT call any external GeoIP
// service for proxy IP lookups.
//
// Why?
//   The TCP-probe path above is fully self-built and leaks zero
//   info beyond a connection from our Vercel IP to the proxy
//   (which the proxy owner sees anyway when admin uses the
//   proxy). NOT a leak.
//
//   But the previous geoIpLookup() called ipwho.is with the
//   proxy IP. ipwho.is logs that query — they learn "someone
//   queried IP X.Y.Z.W". If their logs are compromised / shared
//   / subpoenaed, an adversary could correlate which proxies
//   our admin owns.
//
//   Country + ISP come from:
//     1. Category default (admin sets per-category — see Wave 22G)
//     2. Manual entry on the proxy create form
//     3. (Optional future) self-hosted MaxMind GeoLite2 mmdb
//        bundled in repo — caller would import a separate
//        offline lookup module.
//
// This function intentionally returns nulls. Callers MUST tolerate
// missing country + ISP and surface them via category default or
// manual entry.

export interface GeoIpResult {
  country: string | null;
  country_code: string | null;
  isp: string | null;
  source: null;
}

export async function geoIpLookup(_ip: string): Promise<GeoIpResult> {
  return { country: null, country_code: null, isp: null, source: null };
}
