/**
 * Format proxy list as text (host:port:user:pass per line).
 */
export function formatProxiesAsText(
  proxies: Array<{ host: string; port: number; username?: string | null; password?: string | null }>
): string {
  return proxies
    .map(p => `${p.host}:${p.port}:${p.username ?? ""}:${p.password ?? ""}`)
    .join("\n");
}

/**
 * Format proxy list as Buffer for file attachment.
 */
export function formatProxiesAsBuffer(
  proxies: Array<{ host: string; port: number; username?: string | null; password?: string | null }>
): Buffer {
  return Buffer.from(formatProxiesAsText(proxies), "utf-8");
}
