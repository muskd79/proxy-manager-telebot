/**
 * Telegram webhook IP whitelist validation.
 *
 * Telegram sends webhook requests from two known CIDR ranges. This module
 * validates that an incoming request IP falls within those ranges, providing
 * defense-in-depth alongside the secret token check. The secret token alone
 * is sufficient for authenticity, but IP validation blocks traffic from
 * spoofed secret leaks before they reach expensive DB queries.
 *
 * If Telegram changes their IP ranges, set SKIP_TELEGRAM_IP_CHECK=true as an
 * emergency bypass until the ranges below are updated.
 *
 * Updated ranges are published at https://core.telegram.org/resources/cidr.txt
 *
 * @see https://core.telegram.org/bots/webhooks#the-short-version
 */

/** Telegram's documented webhook source IP ranges. */
const TELEGRAM_CIDR_RANGES: ReadonlyArray<{ network: number; mask: number }> = [
  { network: ipToInt("149.154.160.0"), mask: 20 },
  { network: ipToInt("91.108.4.0"), mask: 22 },
];

/** Convert dotted-quad IPv4 string to 32-bit unsigned integer. */
function ipToInt(ip: string): number {
  const parts = ip.split(".");
  if (parts.length !== 4) return 0;
  return (
    ((parseInt(parts[0], 10) << 24) |
      (parseInt(parts[1], 10) << 16) |
      (parseInt(parts[2], 10) << 8) |
      parseInt(parts[3], 10)) >>>
    0
  );
}

/**
 * Check whether an IPv4 address falls within Telegram's known webhook ranges.
 *
 * Returns `false` for IPv6 addresses, malformed IPs, IPs outside Telegram's
 * ranges, and empty/unknown values. Returns `true` unconditionally when
 * SKIP_TELEGRAM_IP_CHECK=true is set.
 */
export function isTelegramIp(ip: string): boolean {
  if (process.env.SKIP_TELEGRAM_IP_CHECK === "true") return true;

  if (!ip || ip === "unknown") return false;

  // Strip IPv4-mapped IPv6 prefix (e.g. ::ffff:149.154.160.1)
  const normalized = ip.replace(/^::ffff:/i, "");

  const parts = normalized.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255 || String(n) !== part) return false;
  }

  const ipInt = ipToInt(normalized);

  for (const range of TELEGRAM_CIDR_RANGES) {
    const bitmask = (~0 << (32 - range.mask)) >>> 0;
    if ((ipInt & bitmask) === (range.network & bitmask)) {
      return true;
    }
  }

  return false;
}
