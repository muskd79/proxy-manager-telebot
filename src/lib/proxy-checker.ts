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

/**
 * Check multiple proxies in parallel.
 */
export async function checkProxies(
  proxies: Array<{
    id: string;
    host: string;
    port: number;
    type: "http" | "https" | "socks5";
  }>,
): Promise<Array<{ id: string } & ProxyCheckResult>> {
  const results = await Promise.allSettled(
    proxies.map(async (p) => {
      const result = await checkProxy(p.host, p.port, p.type);
      return { id: p.id, ...result };
    }),
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return { id: proxies[i].id, alive: false, speed_ms: 0 };
  });
}
