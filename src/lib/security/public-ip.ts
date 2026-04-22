/**
 * SSRF defense: reject hostnames/IPs that resolve to non-public addresses.
 *
 * Threat model: an admin (or attacker with leaked admin creds) imports a proxy
 * with `host=127.0.0.1` or `host=169.254.169.254`; the health check opens a
 * raw TCP socket and effectively probes internal services (DB, Redis, AWS
 * instance metadata). `assertPublicHost` blocks this at the boundary.
 *
 * Returns the canonical resolved public IP; callers SHOULD pass that IP
 * (not the original hostname) to the actual connection call to close the
 * DNS-rebinding TOCTOU window.
 */

import dns from "dns";
import net from "net";

export class SsrfBlockedError extends Error {
  constructor(
    public readonly input: string,
    public readonly reason: string,
  ) {
    super(`SSRF blocked: ${input} (${reason})`);
    this.name = "SsrfBlockedError";
  }
}

/** Blocked-name shortlist (fast path; no DNS needed). */
const BLOCKED_NAMES: ReadonlySet<string> = new Set([
  "localhost",
  "localhost.",
  "ip6-localhost",
  "ip6-loopback",
  "0",
  "0.0.0.0",
  "[::]",
  "::",
  "::1",
  "[::1]",
]);

/** IPv4 CIDR blocks to reject. */
const IPV4_BLOCKED: ReadonlyArray<{ network: number; mask: number; label: string }> = [
  { network: v4toInt("0.0.0.0"), mask: 8, label: "this-network 0.0.0.0/8" },
  { network: v4toInt("10.0.0.0"), mask: 8, label: "private 10/8" },
  { network: v4toInt("127.0.0.0"), mask: 8, label: "loopback 127/8" },
  { network: v4toInt("169.254.0.0"), mask: 16, label: "link-local 169.254/16" },
  { network: v4toInt("172.16.0.0"), mask: 12, label: "private 172.16/12" },
  { network: v4toInt("192.168.0.0"), mask: 16, label: "private 192.168/16" },
  { network: v4toInt("198.18.0.0"), mask: 15, label: "benchmark 198.18/15" },
  { network: v4toInt("224.0.0.0"), mask: 4, label: "multicast 224/4" },
  { network: v4toInt("240.0.0.0"), mask: 4, label: "reserved 240/4" },
];

function v4toInt(ip: string): number {
  const parts = ip.split(".");
  return (
    ((parseInt(parts[0], 10) << 24) |
      (parseInt(parts[1], 10) << 16) |
      (parseInt(parts[2], 10) << 8) |
      parseInt(parts[3], 10)) >>> 0
  );
}

/** Check a dotted-quad IPv4 literal against all blocked ranges. */
function isBlockedIpv4(ip: string): string | null {
  const ipInt = v4toInt(ip);
  for (const range of IPV4_BLOCKED) {
    const bitmask = (~0 << (32 - range.mask)) >>> 0;
    if ((ipInt & bitmask) === (range.network & bitmask)) {
      return range.label;
    }
  }
  return null;
}

/** Check an IPv6 literal against loopback/ULA/link-local/IPv4-mapped. */
function isBlockedIpv6(ip: string): string | null {
  const lower = ip.toLowerCase();

  // IPv4-mapped IPv6 (::ffff:x.x.x.x) — re-check as IPv4
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    const v4 = mapped[1];
    const result = isBlockedIpv4(v4);
    if (result) return `IPv4-mapped ${result}`;
    return null;
  }

  if (lower === "::1" || lower === "::") return "IPv6 loopback/unspecified";
  if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return "IPv6 link-local fe80::/10";
  // ULA fc00::/7 — first byte 0xfc or 0xfd
  if (lower.startsWith("fc") || lower.startsWith("fd")) {
    // Match fc00::-fdff:... — the first hextet is fc?? or fd??
    const firstHextet = lower.split(":")[0];
    if (firstHextet.length >= 2 && (firstHextet.startsWith("fc") || firstHextet.startsWith("fd"))) {
      return "IPv6 ULA fc00::/7";
    }
  }

  return null;
}

/**
 * Expand decimal, octal, or hex IP literal encodings into dotted-quad.
 * Returns null if the input doesn't look like a numeric literal.
 * Examples: "2130706433" → "127.0.0.1", "0x7f000001" → "127.0.0.1"
 */
function expandNumericLiteral(host: string): string | null {
  // Pure decimal (>=1 digit)
  if (/^\d+$/.test(host)) {
    const n = parseInt(host, 10);
    if (isFinite(n) && n >= 0 && n <= 0xffffffff) {
      return intToV4(n);
    }
  }
  // Hex: 0x followed by up to 8 hex digits
  if (/^0x[0-9a-fA-F]+$/.test(host)) {
    const n = parseInt(host, 16);
    if (isFinite(n) && n >= 0 && n <= 0xffffffff) {
      return intToV4(n);
    }
  }
  // Dotted forms with octal (0-prefixed) or hex parts: defer to net.isIP below
  return null;
}

function intToV4(n: number): string {
  return [
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ].join(".");
}

/**
 * Throws `SsrfBlockedError` if `host` resolves to a non-public address.
 * Returns the resolved public IP (IPv4 preferred). Callers should connect
 * to the returned IP, not the original hostname, to avoid DNS-rebinding
 * TOCTOU between the check and the actual connect.
 *
 * - Literal IPs: checked against CIDR blocklist (no DNS call).
 * - Hostnames: resolve A + AAAA in parallel; if ANY record is private,
 *   reject (rebinding defense). Return the first public IP on success.
 * - Name shortlist: `localhost`, `0.0.0.0`, `[::]` etc. fail without DNS.
 * - Decimal/hex integer literals are expanded before the CIDR check.
 */
export async function assertPublicHost(host: string): Promise<string> {
  const trimmed = host.trim().replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  if (!trimmed) {
    throw new SsrfBlockedError(host, "empty host");
  }

  if (BLOCKED_NAMES.has(trimmed.toLowerCase())) {
    throw new SsrfBlockedError(host, "blocked name shortlist");
  }

  // Decimal or hex integer encoding of IPv4 (e.g. 2130706433 = 127.0.0.1)
  const expanded = expandNumericLiteral(trimmed);
  const candidate = expanded ?? trimmed;

  // Literal IP path
  const ipVersion = net.isIP(candidate);
  if (ipVersion === 4) {
    const blocked = isBlockedIpv4(candidate);
    if (blocked) throw new SsrfBlockedError(host, blocked);
    return candidate;
  }
  if (ipVersion === 6) {
    const blocked = isBlockedIpv6(candidate);
    if (blocked) throw new SsrfBlockedError(host, blocked);
    return candidate;
  }

  // Reject anything that looks numeric but isn't a valid IP (e.g. "0177.0.0.1" — octal)
  if (/^[\d.:xXa-fA-F]+$/.test(trimmed) && !trimmed.includes(":")) {
    throw new SsrfBlockedError(host, "ambiguous numeric literal (use standard dotted-quad)");
  }

  // Hostname path: resolve A and AAAA, check every record.
  const [v4Results, v6Results] = await Promise.all([
    dns.promises.resolve4(trimmed).catch(() => [] as string[]),
    dns.promises.resolve6(trimmed).catch(() => [] as string[]),
  ]);

  const allIps = [...v4Results, ...v6Results];
  if (allIps.length === 0) {
    throw new SsrfBlockedError(host, "no DNS records");
  }

  // DNS rebinding defense: reject if ANY record is private.
  for (const ip of v4Results) {
    const blocked = isBlockedIpv4(ip);
    if (blocked) {
      throw new SsrfBlockedError(host, `resolves to ${ip} (${blocked})`);
    }
  }
  for (const ip of v6Results) {
    const blocked = isBlockedIpv6(ip);
    if (blocked) {
      throw new SsrfBlockedError(host, `resolves to ${ip} (${blocked})`);
    }
  }

  // Return first public IP (prefer IPv4 for broader compatibility with net.connect).
  return v4Results[0] ?? v6Results[0];
}

/**
 * Synchronous pre-flight check for obvious private literals. Use in Zod
 * validators to fail-fast at parse time without hitting DNS. Returns an
 * error message string if blocked, null if the literal passes.
 *
 * NOTE: does NOT resolve hostnames. A hostname like "internal.corp.local"
 * will pass this check and must still be validated via `assertPublicHost`
 * before any connection attempt.
 */
export function validatePublicHostLiteral(host: string): string | null {
  const trimmed = host.trim().replace(/^\[|\]$/g, "");

  if (!trimmed) return "empty host";
  if (BLOCKED_NAMES.has(trimmed.toLowerCase())) return "blocked name";

  const expanded = expandNumericLiteral(trimmed);
  const candidate = expanded ?? trimmed;

  const v = net.isIP(candidate);
  if (v === 4) return isBlockedIpv4(candidate);
  if (v === 6) return isBlockedIpv6(candidate);

  // Ambiguous numeric literal (octal dotted, etc.) — block conservatively
  if (/^[\d.xX]+$/.test(trimmed) && !trimmed.includes(":") && trimmed !== candidate) {
    return "ambiguous numeric literal";
  }
  return null;
}
