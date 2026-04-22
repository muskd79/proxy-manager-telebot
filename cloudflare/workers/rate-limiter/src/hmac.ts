/**
 * HMAC-SHA256 request authentication.
 *
 * Signing input (canonical):
 *   "hmac/v1:" + timestamp + ":" + keyId + ":" + METHOD + ":"
 *   + host + ":" + path + ":" + canonicalQuery + ":" + bodyHash
 *
 * Where:
 *   timestamp       = unix seconds (integer)
 *   keyId           = "primary" | "secondary" | "admin"
 *   METHOD          = request method uppercased
 *   host            = request URL host (e.g. "rate-limiter.acct.workers.dev")
 *   path            = URL pathname (no leading slash stripped)
 *   canonicalQuery  = sorted key=value pairs joined with "&" ("" if none)
 *   bodyHash        = hex(SHA-256(rawBodyBytes)); empty body -> hash of empty buffer
 *
 * Headers:
 *   X-RL-Signature: t=<unix>,v1=<hex-hmac>
 *   X-RL-Key-Id: primary|secondary|admin
 *
 * Replay defence: timestamp must be within [-CLOCK_SKEW_PAST_SEC, +CLOCK_SKEW_FUTURE_SEC]
 * of Worker clock AND the full signature value must not have been seen
 * within NONCE_TTL_SEC (stored in KV).
 *
 * Timing: we ALWAYS compute the expected HMAC even when the keyId is
 * unknown, to neutralise key-lookup timing side-channels.
 */

import type { Env, HmacVerifyResult, KeyId } from "./types";

const SIGNATURE_RE = /^t=(\d+),v1=([0-9a-f]{64})$/;

/**
 * Verify the signature and replay-nonce of an incoming request.
 * Expects the request body to have been pre-read into `bodyBytes`;
 * the caller is responsible for buffering so the body isn't double-consumed.
 */
export async function verifyHmac(
  req: Request,
  bodyBytes: ArrayBuffer,
  env: Env,
  now: number = Math.floor(Date.now() / 1000),
): Promise<HmacVerifyResult> {
  const sigHeader = req.headers.get("x-rl-signature");
  const keyIdHeader = req.headers.get("x-rl-key-id");

  if (!sigHeader) return { ok: false, reason: "missing_signature" };
  if (!keyIdHeader) return { ok: false, reason: "missing_signature" };

  const match = SIGNATURE_RE.exec(sigHeader);
  if (!match) return { ok: false, reason: "malformed_signature" };
  const tsStr = match[1];
  const sigHex = match[2];
  const ts = parseInt(tsStr, 10);

  const past = parseInt(env.CLOCK_SKEW_PAST_SEC || "10", 10);
  const future = parseInt(env.CLOCK_SKEW_FUTURE_SEC || "5", 10);
  if (ts < now - past) return { ok: false, reason: "expired" };
  if (ts > now + future) return { ok: false, reason: "future" };

  // Pick the right secret. Use a dummy buffer for unknown key IDs so the
  // subtle.importKey + sign path still runs and consumes comparable CPU.
  let secret: string;
  let keyId: KeyId | undefined;
  if (keyIdHeader === "primary") {
    secret = env.RL_SHARED_SECRET_PRIMARY;
    keyId = "primary";
  } else if (keyIdHeader === "secondary" && env.RL_SHARED_SECRET_SECONDARY) {
    secret = env.RL_SHARED_SECRET_SECONDARY;
    keyId = "secondary";
  } else if (keyIdHeader === "admin") {
    secret = env.RL_ADMIN_SECRET;
    keyId = "admin";
  } else {
    secret = env.RL_SHARED_SECRET_PRIMARY; // dummy compute path
    keyId = undefined;
  }

  const url = new URL(req.url);
  const canonicalQuery = canonicaliseQuery(url.searchParams);
  const bodyHash = await sha256Hex(bodyBytes);

  const input =
    "hmac/v1:" +
    tsStr +
    ":" +
    keyIdHeader +
    ":" +
    req.method.toUpperCase() +
    ":" +
    url.host +
    ":" +
    url.pathname +
    ":" +
    canonicalQuery +
    ":" +
    bodyHash;

  const expectedHex = await computeHmacHex(secret, input);
  const providedBytes = hexToBytes(sigHex);
  const expectedBytes = hexToBytes(expectedHex);

  // Replay nonce check — key off the full signature, not just the HMAC, so
  // a caller re-signing with a new timestamp still gets a fresh nonce.
  const nonceKey = "nonce:" + sigHex;
  const seen = await env.NONCE_STORE.get(nonceKey);
  if (seen) return { ok: false, reason: "nonce_replay" };

  if (!keyId) return { ok: false, reason: "bad_key_id" };

  if (!constantTimeEqual(providedBytes, expectedBytes)) {
    return { ok: false, reason: "signature_mismatch" };
  }

  // Claim the nonce AFTER signature match so we don't DoS legit callers
  // who happen to retry with the same signature after a network blip.
  const ttl = parseInt(env.NONCE_TTL_SEC || "15", 10);
  await env.NONCE_STORE.put(nonceKey, "1", { expirationTtl: ttl });

  return { ok: true, keyId };
}

// ---------------------------------------------------------------------------
// Signing helper — exported so the Vercel client can reuse the same format.
// (Not used inside the Worker itself; kept here for docs + future porting.)
// ---------------------------------------------------------------------------
export async function signingInput(opts: {
  timestamp: number;
  keyId: KeyId;
  method: string;
  host: string;
  path: string;
  canonicalQuery: string;
  bodyHash: string;
}): Promise<string> {
  return (
    "hmac/v1:" +
    String(opts.timestamp) +
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
    opts.bodyHash
  );
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

async function computeHmacHex(secret: string, input: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, enc.encode(input));
  return bytesToHex(new Uint8Array(signed));
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

export function canonicaliseQuery(params: URLSearchParams): string {
  const pairs: Array<[string, string]> = [];
  for (const [k, v] of params) pairs.push([k, v]);
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return pairs.map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
}

function bytesToHex(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, "0");
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
