import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireAnyRole } from "@/lib/auth";

/**
 * GET /api/vendors/orders/[orderId]
 * Single vendor order with its allocations + spawned proxies (for the Order
 * status modal in the admin UI). Read-only — any role.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const supabase = await createClient();
  const { error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  const { orderId } = await params;

  try {
    const { data: order, error: orderErr } = await supabase
      .from("vendor_orders")
      .select(
        `id, vendor_id, vendor_product_id, idempotency_key, quantity, unit_cost_usd,
         total_cost_usd, status, failure_category, last_error, attempt_count,
         vendor_order_ref, dlq_at, next_attempt_at, created_at, updated_at,
         vendor:vendors(id, slug, display_name),
         product:vendor_products(id, name, type, unit_price_usd)`,
      )
      .eq("id", orderId)
      .single();

    if (orderErr || !order) {
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 },
      );
    }

    const { data: allocations } = await supabase
      .from("vendor_allocations")
      .select(
        "id, vendor_allocation_ref, rotation_url, sticky_session_id, health_status, last_health_at, created_at, proxy_id",
      )
      .eq("vendor_order_id", orderId)
      .order("created_at", { ascending: true });

    return NextResponse.json({
      success: true,
      data: {
        order,
        allocations: allocations ?? [],
      },
    });
  } catch (err) {
    console.error(
      "single order GET unexpected:",
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
