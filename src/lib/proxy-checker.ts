import net from "net";

export interface ProxyCheckResult {
  alive: boolean;
  speed_ms: number;
}

/**
 * Check if a proxy is alive by attempting a TCP connection.
 * Measures latency in milliseconds.
 * Timeout: 10 seconds.
 */
export async function checkProxy(
  host: string,
  port: number,
  _type: "http" | "https" | "socks5"
): Promise<ProxyCheckResult> {
  const timeout = 10_000;

  return new Promise<ProxyCheckResult>((resolve) => {
    const start = Date.now();

    const socket = net.createConnection({ host, port, timeout }, () => {
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
  }>
): Promise<Array<{ id: string } & ProxyCheckResult>> {
  const results = await Promise.allSettled(
    proxies.map(async (p) => {
      const result = await checkProxy(p.host, p.port, p.type);
      return { id: p.id, ...result };
    })
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return { id: proxies[i].id, alive: false, speed_ms: 0 };
  });
}
