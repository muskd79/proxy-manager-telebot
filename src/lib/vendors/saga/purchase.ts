/**
 * Purchase saga — enqueue path.
 *
 * API route calls `enqueuePurchase()` to write a new vendor_orders row in
 * the `pending` state. The DB `vendor_orders.idempotency_key UNIQUE`
 * constraint guarantees a retry with the same key returns the existing
 * row (409 from the caller's perspective) rather than creating a duplicate.
 *
 * This function does NOT call the vendor. The reconciler in `drain.ts`
 * claims pending rows and makes the real-money call.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { vendorOrderMachine } from "@/lib/state-machine/vendor-order";
import type { VendorOrderStatus } from "@/lib/state-machine/vendor-order";

export interface EnqueuePurchaseRequest {
  vendorId: string;
  vendorProductId: string | null;
  adminId: string;
  idempotencyKey: string; // UUIDv7 from client
  quantity: number;
  unitCostUsd: number;
}

export interface EnqueuePurchaseResult {
  orderId: string;
  status: VendorOrderStatus;
  /** True when the row already existed (idempotent re-submit). */
  deduplicated: boolean;
}

export async function enqueuePurchase(
  supabase: SupabaseClient,
  req: EnqueuePurchaseRequest,
): Promise<EnqueuePurchaseResult> {
  if (req.quantity <= 0) {
    throw new Error("quantity must be positive");
  }
  if (req.unitCostUsd < 0) {
    throw new Error("unit cost must be non-negative");
  }
  if (!req.idempotencyKey || req.idempotencyKey.length > 128) {
    throw new Error("idempotencyKey must be 1..128 chars");
  }

  const totalCost = Number((req.unitCostUsd * req.quantity).toFixed(4));

  // Idempotent insert: ON CONFLICT on idempotency_key DO NOTHING, then
  // SELECT to return the row regardless of whether it was just inserted.
  const insertResult = await supabase
    .from("vendor_orders")
    .insert({
      vendor_id: req.vendorId,
      vendor_product_id: req.vendorProductId,
      admin_id: req.adminId,
      idempotency_key: req.idempotencyKey,
      quantity: req.quantity,
      unit_cost_usd: req.unitCostUsd,
      total_cost_usd: totalCost,
      status: "pending",
    })
    .select("id, status")
    .single();

  if (!insertResult.error && insertResult.data) {
    return {
      orderId: insertResult.data.id,
      status: insertResult.data.status as VendorOrderStatus,
      deduplicated: false,
    };
  }

  // Distinguish unique-violation (deduplicated) from real errors.
  const code = (insertResult.error as { code?: string } | null)?.code;
  if (code !== "23505") {
    throw new Error(
      `enqueuePurchase failed: ${insertResult.error?.message ?? "unknown"}`,
    );
  }

  // Conflict on idempotency_key — fetch the existing row.
  const existing = await supabase
    .from("vendor_orders")
    .select("id, status")
    .eq("idempotency_key", req.idempotencyKey)
    .single();

  if (existing.error || !existing.data) {
    throw new Error(
      `enqueuePurchase dedup lookup failed: ${existing.error?.message ?? "not found"}`,
    );
  }

  return {
    orderId: existing.data.id,
    status: existing.data.status as VendorOrderStatus,
    deduplicated: true,
  };
}

/** Guard a status transition at the app boundary before SQL round-trip. */
export function assertValidTransition(
  from: VendorOrderStatus,
  to: VendorOrderStatus,
): void {
  if (!vendorOrderMachine.canTransition(from, to)) {
    throw new Error(`Invalid vendor order transition: ${from} -> ${to}`);
  }
}
