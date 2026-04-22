/**
 * Outbox drain — the reconciler.
 *
 * Called by the Vercel Cron at `/api/cron/outbox-drain` every minute.
 * Pops up to N pending vendor_orders via `FOR UPDATE SKIP LOCKED`, calls
 * the vendor via the adapter, and moves each row into its next state.
 *
 * Contract:
 * - `pending -> processing` (immediately after claim)
 * - adapter returns OK sync           -> `processing -> fulfilled`
 * - adapter returns async poll         -> leave in `processing` (reconciler
 *                                         in a later run fetches the status)
 * - adapter throws retryable error     -> `processing -> pending` with
 *                                         `next_attempt_at = now + backoff`
 * - adapter throws non-retryable       -> `processing -> failed`
 * - attempt_count >= MAX               -> dlq_at = now, `-> failed`
 *
 * This module is dependency-injected so tests can run it without a DB
 * connection or a real vendor HTTP call. `deps` in real use wires:
 *   supabase -> supabaseAdmin (service role)
 *   resolveVendor -> buildVendorCtx
 *   now -> () => new Date()
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  VendorAdapter,
  VendorCtx,
  OrderResult,
} from "../types";
import { VendorError, VendorRateLimitError, VendorAuthError } from "../errors";
import {
  computeBackoffMs,
  shouldDlq,
  MAX_ATTEMPTS_BEFORE_DLQ,
} from "./backoff";
import { rateLimitTake } from "../rate-limit/client";

interface PendingOrderRow {
  id: string;
  vendor_id: string;
  vendor_product_id: string | null;
  idempotency_key: string;
  quantity: number;
  attempt_count: number;
}

export interface DrainDeps {
  supabase: SupabaseClient;
  resolveVendor: (
    vendorId: string,
  ) => Promise<{ adapter: VendorAdapter; ctx: VendorCtx; vendor: { slug: string } }>;
  now: () => Date;
  /** Reconciler instance identifier for locked_by (Vercel function id). */
  workerId: string;
  /** Visibility timeout in ms. Default 90s. */
  lockTtlMs?: number;
}

export interface DrainResult {
  claimed: number;
  fulfilled: number;
  failed: number;
  retried: number;
  dlq: number;
  skippedRateLimited: number;
}

export async function drainOutbox(
  deps: DrainDeps,
  limit = 20,
): Promise<DrainResult> {
  const lockTtlMs = deps.lockTtlMs ?? 90_000;
  const result: DrainResult = {
    claimed: 0,
    fulfilled: 0,
    failed: 0,
    retried: 0,
    dlq: 0,
    skippedRateLimited: 0,
  };

  // 1) Release stuck locks from crashed workers before we claim new ones.
  await deps.supabase.rpc("fn_release_stuck_vendor_orders", { p_max: 100 });

  // 2) Claim up to `limit` pending rows via SELECT FOR UPDATE SKIP LOCKED.
  //    Done as a single RPC-free pattern via an atomic UPDATE ... RETURNING.
  //    Supabase's supabase-js doesn't expose raw FOR UPDATE SKIP LOCKED, so
  //    we rely on a SECURITY DEFINER helper. For v1 we use a simpler pattern:
  //    fetch ids then update each with a conditional `eq("status", "pending")`.
  const { data: candidates, error: fetchErr } = await deps.supabase
    .from("vendor_orders")
    .select(
      "id, vendor_id, vendor_product_id, idempotency_key, quantity, attempt_count",
    )
    .eq("status", "pending")
    .is("dlq_at", null)
    .or(
      `next_attempt_at.is.null,next_attempt_at.lte.${deps.now().toISOString()}`,
    )
    .order("created_at", { ascending: true })
    .limit(limit);

  if (fetchErr) {
    throw new Error(`drainOutbox select failed: ${fetchErr.message}`);
  }

  const rows = (candidates ?? []) as PendingOrderRow[];

  for (const row of rows) {
    const claimed = await tryClaim(deps, row, lockTtlMs);
    if (!claimed) continue;
    result.claimed += 1;

    try {
      await processClaimed(deps, row, result);
    } catch (err) {
      // Last-resort safety net — transition to failed with generic error.
      console.error(
        `outbox worker error order=${row.id}:`,
        err instanceof Error ? err.message : String(err),
      );
      await markFailed(deps, row.id, "unexpected_error", String(err), true);
      result.failed += 1;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function tryClaim(
  deps: DrainDeps,
  row: PendingOrderRow,
  lockTtlMs: number,
): Promise<boolean> {
  const lockedUntil = new Date(deps.now().getTime() + lockTtlMs).toISOString();
  const newAttemptCount = row.attempt_count + 1;

  const { data, error } = await deps.supabase
    .from("vendor_orders")
    .update({
      status: "processing",
      attempt_count: newAttemptCount,
      locked_by: deps.workerId,
      locked_until: lockedUntil,
    })
    .eq("id", row.id)
    .eq("status", "pending") // guard: another worker may have claimed
    .select("id")
    .single();

  if (error || !data) return false;
  row.attempt_count = newAttemptCount;
  return true;
}

async function processClaimed(
  deps: DrainDeps,
  row: PendingOrderRow,
  result: DrainResult,
): Promise<void> {
  const { adapter, ctx, vendor } = await deps.resolveVendor(row.vendor_id);

  if (!adapter.capabilities.has("createOrder")) {
    await markFailed(
      deps,
      row.id,
      "not_supported",
      `Vendor ${vendor.slug} does not support createOrder`,
      false,
    );
    result.failed += 1;
    return;
  }

  // Look up product SKU (we only need it for the request body).
  let productSku: string | null = null;
  if (row.vendor_product_id) {
    const { data: product } = await deps.supabase
      .from("vendor_products")
      .select("vendor_sku")
      .eq("id", row.vendor_product_id)
      .single();
    productSku = product?.vendor_sku ?? null;
  }
  if (!productSku) {
    await markFailed(
      deps,
      row.id,
      "missing_product",
      "vendor_product_id is null or product row missing",
      false,
    );
    result.failed += 1;
    return;
  }

  // Rate-limit check via the CF Worker token bucket. Fail-open on Worker
  // outage (see rate-limit/client.ts); vendor-side 429 handling below is
  // the real safety net.
  const rl = await rateLimitTake({
    vendorSlug: vendor.slug,
    scope: "default",
    cost: 1,
  });
  if (!rl.allowed) {
    await rescheduleRetry(
      deps,
      row,
      rl.retryAfterMs,
      "rate_limited",
      `CF token bucket empty for vendor=${vendor.slug}`,
    );
    result.skippedRateLimited += 1;
    return;
  }

  let orderResult: OrderResult;
  try {
    orderResult = await adapter.createOrder(ctx, {
      productSku,
      quantity: row.quantity,
      idempotencyKey: row.idempotency_key,
    });
  } catch (err) {
    if (err instanceof VendorRateLimitError) {
      await rescheduleRetry(deps, row, err.retryAfterMs, "rate_limited", err.message);
      result.skippedRateLimited += 1;
      return;
    }
    if (err instanceof VendorAuthError) {
      await markFailed(deps, row.id, "auth_failed", err.message, false);
      result.failed += 1;
      return;
    }
    if (err instanceof VendorError && isRetryable(err)) {
      await rescheduleRetry(
        deps,
        row,
        computeBackoffMs(row.attempt_count),
        err.code,
        err.message,
      );
      result.retried += 1;
      return;
    }
    // Non-retryable VendorError or unknown.
    const msg = err instanceof Error ? err.message : String(err);
    const code =
      err instanceof VendorError ? err.code : "unexpected_error";
    await markFailed(deps, row.id, code, msg, false);
    result.failed += 1;
    return;
  }

  if (orderResult.kind === "sync") {
    await markFulfilled(deps, row.id, orderResult.vendorOrderRef);
    await insertAllocations(deps, row.id, row.vendor_id, orderResult);
    result.fulfilled += 1;
  } else if (orderResult.kind === "async") {
    // Leave in processing; set next_attempt_at to pollAfter so a future
    // drain tick fetches the allocation.
    await deps.supabase
      .from("vendor_orders")
      .update({
        vendor_order_ref: orderResult.vendorOrderRef,
        next_attempt_at: orderResult.pollAfter.toISOString(),
        // Release the lock so other workers aren't blocked.
        locked_by: null,
        locked_until: null,
      })
      .eq("id", row.id);
    result.retried += 1;
  } else {
    // webhook-driven: vendor will POST a signed event when ready.
    // We store the ref and keep the order in processing; the webhook handler
    // transitions to fulfilled.
    await deps.supabase
      .from("vendor_orders")
      .update({
        vendor_order_ref: orderResult.vendorOrderRef,
        locked_by: null,
        locked_until: null,
      })
      .eq("id", row.id);
  }
}

async function rescheduleRetry(
  deps: DrainDeps,
  row: PendingOrderRow,
  delayMs: number,
  failureCategory: string,
  lastError: string,
): Promise<void> {
  const nextAt = new Date(deps.now().getTime() + Math.max(delayMs, 1_000));

  if (shouldDlq(row.attempt_count)) {
    await deps.supabase
      .from("vendor_orders")
      .update({
        status: "failed",
        dlq_at: deps.now().toISOString(),
        failure_category: "max_attempts_exceeded",
        last_error: `attempt_count=${row.attempt_count} >= ${MAX_ATTEMPTS_BEFORE_DLQ}: ${lastError}`,
        locked_by: null,
        locked_until: null,
      })
      .eq("id", row.id);
    return;
  }

  await deps.supabase
    .from("vendor_orders")
    .update({
      status: "pending", // processing -> pending (valid transition for retry)
      next_attempt_at: nextAt.toISOString(),
      failure_category: failureCategory,
      last_error: lastError,
      locked_by: null,
      locked_until: null,
    })
    .eq("id", row.id);
}

async function markFailed(
  deps: DrainDeps,
  orderId: string,
  category: string,
  message: string,
  dlq: boolean,
): Promise<void> {
  await deps.supabase
    .from("vendor_orders")
    .update({
      status: "failed",
      failure_category: category,
      last_error: message,
      dlq_at: dlq ? deps.now().toISOString() : null,
      locked_by: null,
      locked_until: null,
    })
    .eq("id", orderId);
}

async function markFulfilled(
  deps: DrainDeps,
  orderId: string,
  vendorOrderRef: string,
): Promise<void> {
  await deps.supabase
    .from("vendor_orders")
    .update({
      status: "fulfilled",
      vendor_order_ref: vendorOrderRef,
      locked_by: null,
      locked_until: null,
    })
    .eq("id", orderId);
}

async function insertAllocations(
  deps: DrainDeps,
  orderId: string,
  vendorId: string,
  result: Extract<OrderResult, { kind: "sync" }>,
): Promise<void> {
  for (const a of result.allocations) {
    const { data: proxy, error: proxyErr } = await deps.supabase
      .from("proxies")
      .insert({
        host: a.host,
        port: a.port,
        type: a.type,
        username: a.username,
        password: a.password,
        country: a.country,
        status: "available",
        is_deleted: false,
        source: "vendor",
        vendor_id: vendorId,
        vendor_order_id: orderId,
        rotation_mode: a.rotationUrl ? "rotating" : a.stickySessionId ? "sticky" : "static",
      })
      .select("id")
      .single();

    if (proxyErr || !proxy) {
      console.error(
        `insertAllocations proxy insert failed for order=${orderId}:`,
        proxyErr?.message,
      );
      continue;
    }

    const { data: allocation } = await deps.supabase
      .from("vendor_allocations")
      .insert({
        vendor_order_id: orderId,
        proxy_id: proxy.id,
        vendor_allocation_ref: a.vendorAllocationRef,
        rotation_url: a.rotationUrl,
        sticky_session_id: a.stickySessionId,
        health_status: "unknown",
      })
      .select("id")
      .single();

    if (allocation) {
      await deps.supabase
        .from("proxies")
        .update({ vendor_allocation_id: allocation.id })
        .eq("id", proxy.id);
    }
  }
}

function isRetryable(err: VendorError): boolean {
  return (
    err.code === "network_error" ||
    err.code === "timeout" ||
    err.code === "vendor_error"
  );
}
