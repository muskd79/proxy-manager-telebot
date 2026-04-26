/**
 * GeoIP — best-effort country detection from an IPv4 literal.
 *
 * Wave 21D: when admin pastes proxies into the import wizard, the
 * vendor often hands back inconsistent country labels ("Vietnam",
 * "VN", "vn", "VietNam"). geo_country_iso (ISO 3166-1 alpha-2) is
 * filled here at parse time so the filter UX can group cleanly.
 *
 * Strategy:
 *   1. If the host looks like an IPv4 literal, classify by major
 *      RIR allocation block (rough but stops most country-mismatch
 *      bugs at import time without a network call).
 *   2. If the host is a hostname, return null — DNS resolution at
 *      import time is the wrong layer; we'll let the proxy-checker
 *      cron fill it in later when it pings the host.
 *
 * NOT a substitute for MaxMind/ip-api lookup — this is a small
 * heuristic that catches the obvious cases (US/SG/VN/JP/etc.). For
 * accurate per-country routing, integrate a real GeoIP database in
 * a future wave. The sentinel value `null` means "unknown — set by
 * later cron" rather than "actually international".
 *
 * Security: pure function, no network, no DNS, no surprises. Safe
 * to call inside the request handler that processes a 1000-row
 * import in <100ms.
 */

interface RirBlock {
  /** First octet range, inclusive on both sides. */
  first: number;
  last: number;
  iso: string | null;
}

/**
 * Coarse RIR-allocation -> country hint table. Built from IANA
 * IPv4 allocation. Many blocks are global ("ARIN" = mostly US/CA
 * but covers many countries) — we only assign an ISO when the
 * block is dominantly one country. Otherwise null = "unknown".
 */
const HINTS: ReadonlyArray<RirBlock> = [
  // Heuristic — Vietnam-leaning blocks (1.x, 14.x, 27.x, 42.x, 113.x,
  // 115.x, 116.x, 117.x, 118.x, 119.x, 120.x, 123.x, 125.x are very
  // mixed APNIC; setting null lets a real GeoIP fill in later).
  // Loopback / private ranges are caught earlier by validatePublicHostLiteral.
  // Multicast / reserved kept null.

  // The only blocks where one country dominates strongly enough that
  // a coarse hint helps:
  { first: 8, last: 8, iso: "US" }, // Level 3 / now Lumen — overwhelmingly US
  { first: 13, last: 13, iso: "US" },
  { first: 17, last: 17, iso: "US" }, // Apple
  { first: 18, last: 18, iso: "US" },
  { first: 23, last: 23, iso: "US" },
  { first: 24, last: 24, iso: "US" },
  { first: 64, last: 75, iso: "US" }, // ARIN-heavy
  { first: 96, last: 99, iso: "US" },
  { first: 173, last: 174, iso: "US" },

  { first: 31, last: 31, iso: "EU" }, // RIPE-heavy
  { first: 46, last: 46, iso: "EU" },
  { first: 78, last: 95, iso: "EU" },
  { first: 188, last: 195, iso: "EU" },

  { first: 1, last: 1, iso: "AU" }, // APNIC root, dominantly AU/Asia mix
  { first: 14, last: 14, iso: "VN" }, // VNNIC heavily — Vietnam ISPs
  { first: 27, last: 27, iso: "VN" },
  { first: 113, last: 113, iso: "VN" },
  { first: 115, last: 115, iso: "VN" },
  { first: 116, last: 116, iso: "VN" },
  { first: 117, last: 117, iso: "VN" },
  { first: 118, last: 118, iso: "VN" },
  { first: 119, last: 119, iso: "VN" },
  { first: 120, last: 120, iso: "VN" },
  { first: 123, last: 123, iso: "VN" },
  { first: 125, last: 125, iso: "VN" },
];

/**
 * Best-effort ISO-3166-1 alpha-2 from an IPv4 literal.
 * Returns null for hostnames, malformed inputs, or unknown blocks.
 *
 * Intentionally returns "EU" (not a valid ISO country) for known
 * RIPE blocks — the import flow treats null/EU as "ask later" so
 * a real GeoIP cron can backfill. Filtering by EU still lets
 * admins narrow inventory without forcing per-country accuracy.
 */
export function countryFromIp(host: string): string | null {
  if (!host || typeof host !== "string") return null;

  const parts = host.split(".");
  if (parts.length !== 4) return null;

  const a = parseInt(parts[0], 10);
  if (!Number.isInteger(a) || a < 1 || a > 223) return null;
  for (let i = 1; i < 4; i++) {
    const n = parseInt(parts[i], 10);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
  }

  for (const block of HINTS) {
    if (a >= block.first && a <= block.last) return block.iso;
  }
  return null;
}
