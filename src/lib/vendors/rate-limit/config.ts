/**
 * Per-vendor rate-limit configuration.
 *
 * The saga reads this map before calling the CF Worker token bucket.
 * `capacity` is the bucket size (burst tolerance); `refillPerSec` is the
 * sustained throughput. A caller that consistently exceeds refillPerSec
 * will exhaust the bucket and get 429s → saga reschedules with backoff.
 *
 * Values are defensive: we'd rather hit OUR limiter than the vendor's
 * (our 429 is a controlled reschedule; the vendor's 429 can trigger
 * account suspensions).
 */

export interface RateLimitConfig {
  capacity: number;
  refillPerSec: number;
}

export const DEFAULT_RL_CONFIG: RateLimitConfig = {
  capacity: 30,
  refillPerSec: 0.5, // 30 rpm sustained
};

/**
 * Per-vendor overrides. Keys match the vendors.slug column value.
 * Tune from the vendor's documented rate limits minus a 20% safety margin.
 */
export const RATE_LIMIT_CONFIG: Readonly<Record<string, RateLimitConfig>> = Object.freeze({
  // Webshare: documented 1000 req/min (16.7 rps) — capped conservatively.
  webshare: { capacity: 100, refillPerSec: 10 },

  // Smartproxy/Decodo: documented 60 rpm (1 rps).
  smartproxy: { capacity: 20, refillPerSec: 0.8 },

  // Evomi: rate limits undocumented — defensive default.
  evomi: { capacity: 20, refillPerSec: 0.3 },

  // Infatica: rate limits undocumented — defensive default.
  infatica: { capacity: 20, refillPerSec: 0.3 },

  // Proxy-Cheap: Beta API, undocumented — very conservative.
  proxy_cheap: { capacity: 10, refillPerSec: 0.2 },
});

export function getRateLimitConfig(slug: string): RateLimitConfig {
  return RATE_LIMIT_CONFIG[slug] ?? DEFAULT_RL_CONFIG;
}
