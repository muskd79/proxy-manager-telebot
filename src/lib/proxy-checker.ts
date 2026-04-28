import net from "net";
import { assertPublicHost, SsrfBlockedError } from "@/lib/security/public-ip";

export interface ProxyCheckResult {
  alive: boolean;
  speed_ms: number;
  /** Set when the check was rejected pre-connect by the SSRF guard. */
  ssrf_blocked?: boolean;
  ssrf_reason?: string;
}

/**
 * Check if a proxy is alive by opening a raw TCP connection to host:port.
 *
 * SSRF: `host` is resolved through `assertPublicHost` which rejects private,
 * loopback, link-local, and multicast ranges. The returned IP (not the
 * original hostname) is used for the actual connect to close the DNS
 * rebinding TOCTOU window.
 */
export async function checkProxy(
  host: string,
  port: number,
  _type: "http" | "https" | "socks5",
): Promise<ProxyCheckResult> {
  const timeout = 10_000;
  const start = Date.now();

  // SSRF pre-flight: reject private/loopback/link-local before opening a socket.
  let pinnedIp: string;
  try {
    pinnedIp = await assertPublicHost(host);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return {
        alive: false,
        speed_ms: 0,
        ssrf_blocked: true,
        ssrf_reason: err.reason,
      };
    }
    // DNS failure / unexpected error — treat as dead, not SSRF.
    return { alive: false, speed_ms: Date.now() - start };
  }

  return new Promise<ProxyCheckResult>((resolve) => {
    const socket = net.createConnection({ host: pinnedIp, port, timeout }, () => {
      const speed_ms = Date.now() - start;
      socket.destroy();
      resolve({ alive: true, speed_ms });
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve({ alive: false, speed_ms: timeout });
    });

    socket.on("error", () => {
      socket.destroy();
      resolve({ alive: false, speed_ms: Date.now() - start });
    });
  });
}

// Wave 22D-5: deleted unused export `checkProxies` (plural batch).
// /api/proxies/check builds its own loop; no caller needed this
// helper. If batch checking is needed later, re-derive from
// checkProxy() — it's a 5-line wrapper.
