/**
 * Rate-limiter Worker entrypoint.
 *
 * Routes (all require HMAC auth + valid key format):
 *   POST /take   -> deduct from the (vendor_slug, scope) token bucket
 *   GET  /peek   -> read bucket state without mutation
 *   POST /reset  -> admin-only refill (requires admin key ID)
 *
 * Errors:
 *   400 malformed key / body
 *   401 HMAC failure (generic body, no detail)
 *   404 unknown path
 *   413 body too large (> 8 KB)
 *   500 DO storage error
 */

import { TokenBucketDO } from "./token-bucket";
import { verifyHmac } from "./hmac";
import { isValidKey } from "./key-guard";
import type { Env, TakeReq, ResetReq } from "./types";

export { TokenBucketDO };

const MAX_BODY_BYTES = 8 * 1024;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await route(req, env);
    } catch (err) {
      // Log to CF runtime console (visible in wrangler tail).
      console.error("worker uncaught:", err instanceof Error ? err.message : String(err));
      return json({ error: "internal_error" }, 500);
    }
  },
};

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  // 1. Read + size-check the body. We must buffer once for (a) HMAC body
  //    hash and (b) downstream JSON parse. Streams can only be read once.
  const bodyBytes = await req.arrayBuffer();
  if (bodyBytes.byteLength > MAX_BODY_BYTES) {
    return json({ error: "body_too_large" }, 413);
  }

  // 2. HMAC + replay-nonce verify. This also emits the analytics event on
  //    failure so we can alert on sustained 401 rate.
  const hv = await verifyHmac(req, bodyBytes, env);
  if (!hv.ok) {
    emit(env, { kind: "auth_failure", reason: hv.reason ?? "unknown", path });
    return json({ error: "unauthorized" }, 401);
  }

  // 3. Admin routes only accept the admin key.
  if (path === "/reset") {
    if (hv.keyId !== "admin") return json({ error: "admin_required" }, 403);
    if (method !== "POST") return json({ error: "method_not_allowed" }, 405);
    return handleReset(env, bodyBytes);
  }

  // 4. Non-admin routes accept primary or secondary.
  if (hv.keyId !== "primary" && hv.keyId !== "secondary") {
    return json({ error: "wrong_key_scope" }, 403);
  }

  if (path === "/take" && method === "POST") {
    return handleTake(env, bodyBytes);
  }
  if (path === "/peek" && method === "GET") {
    return handlePeek(env, url);
  }

  return json({ error: "not_found" }, 404);
}

// ---------------------------------------------------------------------------
// Route handlers — each delegates to the TokenBucketDO instance for the key.
// ---------------------------------------------------------------------------

async function handleTake(env: Env, bodyBytes: ArrayBuffer): Promise<Response> {
  const body = parseJson<TakeReq>(bodyBytes);
  if (!body) return json({ error: "bad_json" }, 400);
  if (!isValidKey(body.key)) return json({ error: "bad_key" }, 400);
  if (!(body.capacity > 0)) return json({ error: "bad_capacity" }, 400);
  if (!(body.refillPerSec > 0)) return json({ error: "bad_refill_rate" }, 400);

  const id = env.TOKEN_BUCKET.idFromName(body.key);
  const stub = env.TOKEN_BUCKET.get(id);
  const doReq = new Request("https://do/take", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  const doResp = await stub.fetch(doReq);
  const doJson = (await doResp.json()) as { allowed: boolean; tokensLeft: number; retryAfterMs: number };

  emit(env, {
    kind: "take",
    key: body.key,
    allowed: doJson.allowed,
    tokensLeft: doJson.tokensLeft,
    retryAfterMs: doJson.retryAfterMs,
  });

  return json(doJson, doResp.status, {
    ...(doResp.status === 429
      ? { "retry-after": String(Math.ceil(doJson.retryAfterMs / 1000)) }
      : {}),
  });
}

async function handlePeek(env: Env, url: URL): Promise<Response> {
  const key = url.searchParams.get("key");
  if (!key || !isValidKey(key)) return json({ error: "bad_key" }, 400);

  const id = env.TOKEN_BUCKET.idFromName(key);
  const stub = env.TOKEN_BUCKET.get(id);
  const doReq = new Request("https://do/peek");
  const doResp = await stub.fetch(doReq);
  const doJson = await doResp.json();
  return json(doJson, 200);
}

async function handleReset(env: Env, bodyBytes: ArrayBuffer): Promise<Response> {
  const body = parseJson<ResetReq>(bodyBytes);
  if (!body) return json({ error: "bad_json" }, 400);
  if (!isValidKey(body.key)) return json({ error: "bad_key" }, 400);

  const id = env.TOKEN_BUCKET.idFromName(body.key);
  const stub = env.TOKEN_BUCKET.get(id);
  const doReq = new Request("https://do/reset", {
    method: "POST",
    body: JSON.stringify({ toCapacity: body.toCapacity ?? true }),
    headers: { "content-type": "application/json" },
  });
  const doResp = await stub.fetch(doReq);
  const doJson = await doResp.json();

  emit(env, { kind: "reset", key: body.key });

  return json(doJson, 200);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJson<T>(bytes: ArrayBuffer): T | null {
  try {
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...extra,
    },
  });
}

type TelemetryEvent =
  | { kind: "take"; key: string; allowed: boolean; tokensLeft: number; retryAfterMs: number }
  | { kind: "auth_failure"; reason: string; path: string }
  | { kind: "reset"; key: string };

function emit(env: Env, ev: TelemetryEvent): void {
  try {
    if (ev.kind === "take") {
      const [vendorSlug, scope] = ev.key.split(":");
      env.RATE_LIMITER_ANALYTICS.writeDataPoint({
        blobs: [vendorSlug, scope, ev.allowed ? "allow" : "deny"],
        doubles: [ev.tokensLeft, ev.retryAfterMs],
        indexes: [vendorSlug],
      });
    } else if (ev.kind === "auth_failure") {
      env.RATE_LIMITER_ANALYTICS.writeDataPoint({
        blobs: ["_auth", ev.reason, ev.path],
        doubles: [1],
        indexes: ["_auth"],
      });
    } else if (ev.kind === "reset") {
      const [vendorSlug, scope] = ev.key.split(":");
      env.RATE_LIMITER_ANALYTICS.writeDataPoint({
        blobs: [vendorSlug, scope, "reset"],
        doubles: [0],
        indexes: [vendorSlug],
      });
    }
  } catch {
    // Analytics failures must not break the hot path.
  }
}
