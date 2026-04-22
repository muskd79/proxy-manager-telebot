/**
 * Shared types for the rate-limiter Worker.
 *
 * Keep types small, named, and documented so a new dev can skim this file
 * and understand every request/response shape without reading the logic.
 */

export interface Env {
  TOKEN_BUCKET: DurableObjectNamespace;
  NONCE_STORE: KVNamespace;
  RATE_LIMITER_ANALYTICS: AnalyticsEngineDataset;
  RL_SHARED_SECRET_PRIMARY: string;
  RL_SHARED_SECRET_SECONDARY?: string;
  RL_ADMIN_SECRET: string;
  CLOCK_SKEW_PAST_SEC: string;
  CLOCK_SKEW_FUTURE_SEC: string;
  NONCE_TTL_SEC: string;
}

export type KeyId = "primary" | "secondary" | "admin";

export interface TakeReq {
  /** `${vendorSlug}:${scope}` — scope defaults to "default" on the Vercel side. */
  key: string;
  /** Bucket size. Used only on cold-start (DO first-init). */
  capacity: number;
  /** Refill rate (tokens per second). */
  refillPerSec: number;
  /** How many tokens to deduct. Default 1. */
  cost?: number;
}

export interface TakeResp {
  allowed: boolean;
  tokensLeft: number;
  /** Milliseconds to wait before retrying. 0 when allowed. */
  retryAfterMs: number;
}

export interface PeekResp {
  tokensLeft: number;
  capacity: number;
  refillPerSec: number;
  lastAccessed: number;
}

export interface ResetReq {
  key: string;
  toCapacity?: boolean;
}

export interface ResetResp {
  tokensLeft: number;
  resetAt: number;
}

export interface ErrorResp {
  error: string;
}

/**
 * Result of HMAC verification. `keyId` tells downstream whether the request
 * came in under the primary, secondary, or admin secret; used for audit.
 */
export interface HmacVerifyResult {
  ok: boolean;
  keyId?: KeyId;
  reason?: "missing_signature" | "malformed_signature" | "expired" | "future" | "bad_key_id" | "signature_mismatch" | "nonce_replay";
}
