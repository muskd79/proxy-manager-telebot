/**
 * TokenBucketDO — Durable Object implementing a lazy-refill token bucket.
 *
 * One DO instance per `(vendor_slug, scope)` key. DOs are single-threaded
 * per instance; concurrent `consume()` calls queue behind each other so
 * the bucket math is race-free without explicit locking.
 *
 * Storage layout (flat, every key is a top-level storage entry for
 * cheapest reads):
 *   tokens        number   current token count (float)
 *   capacity      number   max tokens
 *   refillPerSec  number   tokens per second
 *   lastRefill    number   ms since epoch of last refill calc
 *   lastAccessed  number   ms since epoch of last caller
 *
 * Cold start: when `tokens` is undefined the handler initialises from the
 * first caller's `capacity`/`refillPerSec`. This is self-healing after DO
 * eviction (after 7 days idle per alarm below).
 *
 * GC: every `consume` schedules an alarm 7 days out. On `alarm()` if
 * `lastAccessed` is older than 7 days the DO deletes its storage and
 * dies naturally.
 */

import type { TakeReq, TakeResp, PeekResp, ResetResp } from "./types";

const GC_ALARM_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class TokenBucketDO {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/take" && req.method === "POST") {
      const body = (await req.json()) as TakeReq;
      const result = await this.consume(body);
      return jsonResp(result, result.allowed ? 200 : 429, {
        ...(result.allowed
          ? {}
          : {
              "retry-after": String(Math.ceil(result.retryAfterMs / 1000)),
            }),
      });
    }

    if (path === "/peek" && req.method === "GET") {
      const result = await this.peek();
      return jsonResp(result, 200);
    }

    if (path === "/reset" && req.method === "POST") {
      const body = (await req.json()) as { toCapacity?: boolean };
      const result = await this.reset(body.toCapacity ?? true);
      return jsonResp(result, 200);
    }

    return new Response("Not found", { status: 404 });
  }

  // ---------------------------------------------------------------------
  // Core methods
  // ---------------------------------------------------------------------

  private async consume(req: TakeReq): Promise<TakeResp> {
    const now = Date.now();
    const cost = req.cost ?? 1;
    if (cost <= 0) throw new Error("cost must be positive");

    const st = await this.state.storage.get<{
      tokens?: number;
      capacity?: number;
      refillPerSec?: number;
      lastRefill?: number;
    }>(["tokens", "capacity", "refillPerSec", "lastRefill"]);

    let tokens: number;
    let capacity: number;
    let refillPerSec: number;
    let lastRefill: number;

    if (st.get("tokens") === undefined) {
      // Cold start — initialise from caller's params.
      capacity = req.capacity;
      refillPerSec = req.refillPerSec;
      tokens = capacity;
      lastRefill = now;
    } else {
      capacity = st.get("capacity") as number;
      refillPerSec = st.get("refillPerSec") as number;
      const prevTokens = st.get("tokens") as number;
      const prevRefill = st.get("lastRefill") as number;
      const elapsedSec = Math.max(0, (now - prevRefill) / 1000);
      tokens = Math.min(capacity, prevTokens + elapsedSec * refillPerSec);
      lastRefill = now;
    }

    let allowed: boolean;
    let retryAfterMs: number;
    if (tokens >= cost) {
      tokens -= cost;
      allowed = true;
      retryAfterMs = 0;
    } else {
      const deficit = cost - tokens;
      retryAfterMs = Math.ceil((deficit / refillPerSec) * 1000);
      allowed = false;
    }

    await this.state.storage.put({
      tokens,
      capacity,
      refillPerSec,
      lastRefill,
      lastAccessed: now,
    });

    // Schedule/refresh GC alarm.
    await this.state.storage.setAlarm(now + GC_ALARM_MS);

    return {
      allowed,
      tokensLeft: Math.floor(tokens),
      retryAfterMs,
    };
  }

  private async peek(): Promise<PeekResp> {
    const st = await this.state.storage.get<{
      tokens?: number;
      capacity?: number;
      refillPerSec?: number;
      lastAccessed?: number;
    }>(["tokens", "capacity", "refillPerSec", "lastAccessed"]);

    return {
      tokensLeft: Math.floor((st.get("tokens") as number) ?? 0),
      capacity: (st.get("capacity") as number) ?? 0,
      refillPerSec: (st.get("refillPerSec") as number) ?? 0,
      lastAccessed: (st.get("lastAccessed") as number) ?? 0,
    };
  }

  private async reset(toCapacity: boolean): Promise<ResetResp> {
    const now = Date.now();
    const capacity = ((await this.state.storage.get<number>("capacity")) as number) ?? 0;
    const tokens = toCapacity ? capacity : 0;
    await this.state.storage.put({
      tokens,
      lastRefill: now,
      lastAccessed: now,
    });
    return { tokensLeft: Math.floor(tokens), resetAt: now };
  }

  async alarm(): Promise<void> {
    const lastAccessed = (await this.state.storage.get<number>("lastAccessed")) ?? 0;
    if (Date.now() - lastAccessed >= GC_ALARM_MS) {
      await this.state.storage.deleteAll();
    } else {
      // Re-arm alarm based on lastAccessed.
      await this.state.storage.setAlarm(lastAccessed + GC_ALARM_MS);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResp(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...extraHeaders,
    },
  });
}
