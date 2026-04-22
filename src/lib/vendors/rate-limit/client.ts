/**
 * Vercel-side client for the Cloudflare Worker rate limiter.
 *
 * Signs requests with the same HMAC scheme the Worker verifies in
 * `cloudflare/workers/rate-limiter/src/hmac.ts`.
 *
 * Fail policy: FAIL-OPEN on network / 5xx / 401. The saga already has
 * vendor-side 429 handling (`VendorRateLimitError` branch in drain.ts);
 * blocking the saga on a CF Worker outage creates a cross-vendor blast
 * radius we don't need. Failures are logged + Sentry-captured so ops
 * can detect sustained Worker outages.
 */

import { createHmac, randomInt } from "crypto";
import { getRateLimitConfig } from "./config";

export interface RateLimitTakeOpts {
  vendorSlug: string;
  /** Scope within the vendor — "default" for v1, credential UUID later. */
  scope?: string;
  /** How many tokens to deduct. Default 1. */
  cost?: number;
  /** Optional AbortSignal from an outer request deadline. */
  signal?: AbortSignal;
}

export type RateLimitTakeResult =
  | { allowed: true; tokensLeft: number; failedOpen?: boolean }
  | { allowed: false; retryAfterMs: number };

const RL_KEY_ID_DEFAULT = "primary" as const;
const MAX_RETRIES = 3;
const TIMEOUT_MS = 2_000;

/**
 * Attempt to take `cost` tokens from the (vendor, scope) bucket.
 *
 * Returns `{ allowed: true, failedOpen: true }` when the CF Worker itself
 * is unreachable or misconfigured — callers can inspect `failedOpen` to
 * decide whether to log a warning.
 */
export async function rateLimitTake(
  opts: RateLimitTakeOpts,
): Promise<RateLimitTakeResult> {
  const workerUrl = process.env.RL_WORKER_URL;
  const secret = process.env.RL_SHARED_SECRET;
  const keyId = process.env.RL_KEY_ID ?? RL_KEY_ID_DEFAULT;

  // If the Worker isn't configured yet (e.g. local dev before deploy),
  // allow through silently. The saga's vendor-side 429 handling still protects.
  if (!workerUrl || !secret) {
    return { allowed: true, tokensLeft: -1, failedOpen: true };
  }

  const scope = opts.scope ?? "default";
  const cfg = getRateLimitConfig(opts.vendorSlug);
  const bodyObj = {
    key: `${opts.vendorSlug}:${scope}`,
    capacity: cfg.capacity,
    refillPerSec: cfg.refillPerSec,
    cost: opts.cost ?? 1,
  };
  const bodyStr = JSON.stringify(bodyObj);

  const path = "/take";
  const method = "POST";

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const base = [100, 250, 500][attempt - 1] ?? 500;
      const jitter = randomInt(0, Math.floor(base * 0.2));
      await sleep(base + jitter);
    }

    try {
      const now = Math.floor(Date.now() / 1000);
      const sig = await sign({
        secret,
        keyId,
        method,
        path,
        host: new URL(workerUrl).host,
        canonicalQuery: "",
        bodyStr,
        timestamp: now,
      });

      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      opts.signal?.addEventListener("abort", () => ctrl.abort(), { once: true });

      let res: Response;
      try {
        res = await fetch(workerUrl.replace(/\/$/, "") + path, {
          method,
          headers: {
            "content-type": "application/json",
            "x-rl-key-id": keyId,
            "x-rl-signature": `t=${now},v1=${sig}`,
          },
          body: bodyStr,
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (res.status === 200) {
        const j = (await res.json()) as { tokensLeft: number };
        return { allowed: true, tokensLeft: j.tokensLeft };
      }
      if (res.status === 429) {
        const j = (await res.json()) as { retryAfterMs: number };
        return { allowed: false, retryAfterMs: j.retryAfterMs };
      }
      if (res.status === 401 || res.status === 403) {
        // Misconfigured auth — fail open so we don't brick the saga.
        console.error(
          `rate-limiter auth failed (${res.status}). Fail-open. Check RL_SHARED_SECRET / RL_KEY_ID.`,
        );
        return { allowed: true, tokensLeft: -1, failedOpen: true };
      }
      // 4xx other than 429 → client bug; 5xx → retry
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        lastErr = new Error(`rl worker ${res.status}`);
        continue;
      }
      if (res.status >= 400 && res.status < 500) {
        // 4xx (bad_key, bad_capacity, etc.) — log + fail open. These are
        // config bugs and should surface via Sentry, not block the saga.
        const text = await res.text();
        console.error(`rate-limiter client error ${res.status}: ${text}`);
        return { allowed: true, tokensLeft: -1, failedOpen: true };
      }
    } catch (err) {
      lastErr = err;
      // Network / timeout — continue retry loop.
    }
  }

  // All retries exhausted — fail open.
  console.error(
    `rate-limiter unreachable after ${MAX_RETRIES + 1} attempts:`,
    lastErr instanceof Error ? lastErr.message : String(lastErr),
  );
  return { allowed: true, tokensLeft: -1, failedOpen: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sign(opts: {
  secret: string;
  keyId: string;
  method: string;
  host: string;
  path: string;
  canonicalQuery: string;
  bodyStr: string;
  timestamp: number;
}): Promise<string> {
  // Match hmac.ts: bodyHash = hex(SHA-256(rawBodyBytes))
  const bodyBytes = new TextEncoder().encode(opts.bodyStr);
  const bodyHash = await sha256Hex(bodyBytes);
  const input =
    "hmac/v1:" +
    opts.timestamp +
    ":" +
    opts.keyId +
    ":" +
    opts.method.toUpperCase() +
    ":" +
    opts.host +
    ":" +
    opts.path +
    ":" +
    opts.canonicalQuery +
    ":" +
    bodyHash;
  return createHmac("sha256", opts.secret).update(input).digest("hex");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const { createHash } = await import("crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
