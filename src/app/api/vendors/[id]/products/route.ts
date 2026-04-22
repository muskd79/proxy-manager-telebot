import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireAnyRole, requireAdminOrAbove } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { getAdapter } from "@/lib/vendors/registry";
import { VendorError } from "@/lib/vendors/errors";

/**
 * GET /api/vendors/[id]/products
 * Return the cached product catalog for a vendor. Use `?refresh=1` to
 * force a fresh fetch from the vendor API (admin only — billing-sensitive).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  const { id } = await params;
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";

  try {
    if (refresh) {
      if (admin.role === "viewer") {
        return NextResponse.json(
          { success: false, error: "Forbidden: viewer cannot refresh catalog" },
          { status: 403 },
        );
      }
      await syncVendorProducts(id, admin.id, request);
    }

    const { data: products, error } = await supabase
      .from("vendor_products")
      .select("*")
      .eq("vendor_id", id)
      .eq("is_available", true)
      .order("unit_price_usd", { ascending: true });

    if (error) {
      console.error("products select error:", error.message);
      return NextResponse.json(
        { success: false, error: "Failed to read products" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, data: products ?? [] });
  } catch (err) {
    if (err instanceof VendorError) {
      return NextResponse.json(
        { success: false, error: err.message, vendorCode: err.code },
        { status: err.statusCode },
      );
    }
    console.error("products GET unexpected:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/vendors/[id]/products
 * Same as GET?refresh=1. Explicit POST for form-submit simplicity.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  const { id } = await params;

  try {
    const synced = await syncVendorProducts(id, admin.id, request);
    return NextResponse.json({ success: true, data: { synced } });
  } catch (err) {
    if (err instanceof VendorError) {
      return NextResponse.json(
        { success: false, error: err.message, vendorCode: err.code },
        { status: err.statusCode },
      );
    }
    console.error("products POST unexpected:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * Pull the catalog from the vendor API and upsert into vendor_products.
 * Marks rows not present in the vendor response as `is_available=false`
 * rather than deleting them so active orders retain their product linkage.
 */
async function syncVendorProducts(
  vendorId: string,
  adminId: string,
  request: NextRequest,
): Promise<number> {
  // Load vendor + primary credential via service-role client (bypasses RLS).
  const { data: vendor, error: vendorErr } = await supabaseAdmin
    .from("vendors")
    .select("id, slug, base_url, adapter_key, status")
    .eq("id", vendorId)
    .single();

  if (vendorErr || !vendor) {
    throw new VendorError("unknown", "not_found", "Vendor not found", 404);
  }

  if (vendor.status === "deprecated") {
    throw new VendorError(vendor.slug, "invalid_request", "Vendor is deprecated", 400);
  }

  const { data: credRow, error: credErr } = await supabaseAdmin
    .from("vendor_credentials")
    .select("id")
    .eq("vendor_id", vendorId)
    .eq("is_primary", true)
    .is("revoked_at", null)
    .single();

  if (credErr || !credRow) {
    throw new VendorError(vendor.slug, "auth_failed", "No primary credential configured", 401);
  }

  // Decrypt via SECURITY DEFINER RPC.
  const { data: plaintext, error: decryptErr } = await supabaseAdmin.rpc(
    "decrypt_vendor_cred",
    { p_credential_id: credRow.id },
  );
  if (decryptErr || typeof plaintext !== "string") {
    throw new VendorError(vendor.slug, "auth_failed", "Failed to decrypt credential", 500);
  }

  const adapter = getAdapter(vendor.adapter_key);
  const products = await adapter.listProducts({
    apiKey: plaintext,
    baseUrl: vendor.base_url,
    supabase: supabaseAdmin,
    vendorId: vendor.id,
  });

  // Mark everything currently in the table as unavailable first; the upsert
  // below flips only rows that came back in the response.
  await supabaseAdmin
    .from("vendor_products")
    .update({ is_available: false })
    .eq("vendor_id", vendorId);

  for (const p of products) {
    await supabaseAdmin.from("vendor_products").upsert(
      {
        vendor_id: vendorId,
        vendor_sku: p.sku,
        name: p.name,
        type: p.type,
        country: p.country,
        bandwidth_gb: p.bandwidthGb,
        concurrent_threads: p.concurrentThreads,
        unit_price_usd: p.unitPriceUsd,
        billing_cycle: p.billingCycle,
        raw_json: p.raw as Record<string, unknown>,
        is_available: true,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "vendor_id,vendor_sku" },
    );
  }

  logActivity({
    actorType: "admin",
    actorId: adminId,
    action: "vendor.products.sync",
    resourceType: "vendor",
    resourceId: vendorId,
    details: { count: products.length, slug: vendor.slug },
    ipAddress: request.headers.get("x-forwarded-for") || undefined,
    userAgent: request.headers.get("user-agent") || undefined,
  }).catch(console.error);

  return products.length;
}
