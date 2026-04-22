/**
 * Vendor order lifecycle state machine.
 *
 * Mirrors the SQL trigger in migration 021 (fn_assert_vendor_order_transition).
 * The app-side machine catches invalid hops at the application boundary so
 * API callers get a clear 409 response; the DB trigger is defense-in-depth
 * for direct SQL clients (psql session, cron SECURITY DEFINER functions).
 *
 * Lifecycle:
 *   pending    -> processing | failed | cancelled
 *   processing -> fulfilled  | failed | cancelled | pending (retry)
 *   fulfilled  -> refunded   (otherwise terminal)
 *   failed     -> pending    (admin manual retry)
 *   cancelled  -> (terminal)
 *   refunded   -> (terminal)
 *
 * Invariant: `processing -> pending` is ONLY used by the stuck-lock recovery
 * path (`fn_release_stuck_vendor_orders`). Normal retry paths go through
 * `processing -> failed -> pending`.
 */

import { createMachine } from "./create-machine";

export type VendorOrderStatus =
  | "pending"
  | "processing"
  | "fulfilled"
  | "failed"
  | "cancelled"
  | "refunded";

export const vendorOrderMachine = createMachine<VendorOrderStatus>({
  pending: ["processing", "failed", "cancelled"],
  processing: ["fulfilled", "failed", "cancelled", "pending"],
  fulfilled: ["refunded"],
  failed: ["pending"],
  cancelled: [],
  refunded: [],
});

export function isTerminalVendorOrderStatus(s: VendorOrderStatus): boolean {
  return vendorOrderMachine.allowedFrom(s).length === 0;
}
