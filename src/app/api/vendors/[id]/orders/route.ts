import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireAnyRole, requireSuperAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";
import { CreateVendorOrderSchema } from "@/lib/validations";
import { enqueuePurchase } from "@/lib/vendors/saga/purchase";

/**
 * GET /api/vendors/[id]/orders
 * List vendor_orders for one vendor with optional ?status=pending|processing|fulfilled|failed|...
 * filter and ?limit=50&offset=0 paging.
 *
 * Read-only — any role.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  const { id } = await params;
  const status = request.nextUrl.searchParams.get("status");
  const limit = Math.min(
    Math.max(parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50, 1),
    200,
  );
  const offset = Math.max(
    parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0,
    0,
  );

  try {
    let q = supabase
      .from("vendor_orders")
      .select(
        "id, idempotency_key, vendor_product_id, quantity, unit_cost_usd, total_cost_usd, status, failure_category, last_error, attempt_count, vendor_order_ref, dlq_at, created_at, updated_at",
        { count: "exact" },
      )
      .eq("vendor_id", id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) q = q.eq("status", status);

    const { data, count, error } = await q;
    if (error) {
      console.error("vendor orders list error:", error.message);
      return NextResponse.json(
        { success: false, error: "Failed to list orders" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: data ?? [],
      meta: { total: count ?? 0, limit, offset },
    });
  } catch (err) {
    console.error(
      "vendor orders GET unexpected:",
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/vendors/[id]/orders
 * Create a new vendor order (tier-1 API path: enqueues a `pending` row;
 * the cron drain reconciler executes the vendor call).
 *
 * Body: { vendor_product_id, quantity, idempotency_key }
 * Idempotency: UUIDv7 client-generated. UNIQUE constraint on
 * vendor_orders.idempotency_key makes retry safe (returns existing row).
 *
 * Status codes:
 *   201 — new pending row created
 *   200 — existing row returned (idempotent re-submit)
 *   400 — validation error / vendor not found / product mismatch
 *   403 — non-super-admin or cross-origin
 *   422 — vendor is paused or fulfillment_mode=manual (use /import instead)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

  const supabase = await createClient();
  const { admin, error: authError } = await requireSuperAdmin(supabase);
  if (authError) return authError;

  const { id: vendorId } = await params;

  try {
    const body = await request.json();
    const parsed = CreateVendorOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    // 1. Vendor must exist + be active.
    const { data: vendor, error: vendorErr } = await supabaseAdmin
      .from("vendors")
      .select("id, slug, status, adapter_key")
      .eq("id", vendorId)
      .single();
    if (vendorErr || !vendor) {
      return NextResponse.json(
        { success: false, error: "Vendor not found" },
        { status: 404 },
      );
    }
    if (vendor.status !== "active") {
      return NextResponse.json(
        {
          success: false,
          error: `Vendor is ${vendor.status}. Only active vendors can be ordered against.`,
        },
        { status: 422 },
      );
    }

    // 2. Product must exist + match this vendor + be available.
    const { data: product, error: productErr } = await supabaseAdmin
      .from("vendor_products")
      .select("id, vendor_id, name, unit_price_usd, is_available")
      .eq("id", parsed.data.vendor_product_id)
      .single();
    if (productErr || !product) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 },
      );
    }
    if (product.vendor_id !== vendorId) {
      return NextResponse.json(
        { success: false, error: "Product does not belong to this vendor" },
        { status: 400 },
      );
    }
    if (!product.is_available) {
      return NextResponse.json(
        { success: false, error: "Product is no longer available" },
        { status: 422 },
      );
    }

    // 3. Enqueue. UNIQUE(idempotency_key) handles dedup; helper returns
    //    deduplicated=true when the same key was submitted before.
    const result = await enqueuePurchase(supabaseAdmin, {
      vendorId,
      vendorProductId: product.id,
      adminId: admin.id,
      idempotencyKey: parsed.data.idempotency_key,
      quantity: parsed.data.quantity,
      unitCostUsd: Number(product.unit_price_usd),
    });

    logActivity({
      actorType: "admin",
      actorId: admin.id,
      action: result.deduplicated ? "vendor.order.dedup" : "vendor.order.create",
      resourceType: "vendor_order",
      resourceId: result.orderId,
      details: {
        slug: vendor.slug,
        productName: product.name,
        quantity: parsed.data.quantity,
        unitPriceUsd: Number(product.unit_price_usd),
        deduplicated: result.deduplicated,
      },
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    }).catch((e) =>
      console.error(
        "vendor.order log failed:",
        e instanceof Error ? e.message : String(e),
      ),
    );

    return NextResponse.json(
      { success: true, data: { id: result.orderId, status: result.status, deduplicated: result.deduplicated } },
      { status: result.deduplicated ? 200 : 201 },
    );
  } catch (err) {
    console.error(
      "vendor orders POST unexpected:",
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
