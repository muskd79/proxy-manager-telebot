import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireAnyRole, requireAdminOrAbove } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { listAdapterKeys } from "@/lib/vendors/registry";

/**
 * GET /api/vendors
 * List all configured vendor rows (read-only catalog for admin UI).
 * Returns available adapter keys so the admin "Add Vendor" form can
 * constrain the dropdown to registered adapters.
 */
export async function GET(_request: NextRequest) {
  const supabase = await createClient();
  const { error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  try {
    const { data: vendors, error } = await supabase
      .from("vendors")
      .select("id, slug, display_name, status, base_url, adapter_key, default_currency, support_email, rate_limit_rpm, notes, created_at, updated_at")
      .order("display_name", { ascending: true });

    if (error) {
      console.error("vendors list error:", error.message);
      return NextResponse.json(
        { success: false, error: "Failed to list vendors" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        vendors: vendors ?? [],
        availableAdapterKeys: listAdapterKeys(),
      },
    });
  } catch (error) {
    console.error("vendors GET unexpected:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/vendors
 * Register a new vendor row. Credentials are added separately via
 * /api/vendors/[id]/credentials so the adapter can be wired before the
 * first key is set.
 *
 * Super-admin only — vendor setup is a billing-critical action.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { slug, display_name, base_url, adapter_key, support_email, rate_limit_rpm, notes } = body ?? {};

    if (!slug || !display_name || !base_url || !adapter_key) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: slug, display_name, base_url, adapter_key" },
        { status: 400 },
      );
    }

    if (!listAdapterKeys().includes(adapter_key)) {
      return NextResponse.json(
        {
          success: false,
          error: `Unknown adapter_key "${adapter_key}". Registered: ${listAdapterKeys().join(", ")}`,
        },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from("vendors")
      .insert({
        slug,
        display_name,
        base_url,
        adapter_key,
        status: "paused", // vendor starts paused; activate after credentials added
        support_email: support_email ?? null,
        rate_limit_rpm: rate_limit_rpm ?? 60,
        notes: notes ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error("vendors insert error:", error.message);
      return NextResponse.json(
        { success: false, error: "Failed to create vendor" },
        { status: 500 },
      );
    }

    logActivity({
      actorType: "admin",
      actorId: admin.id,
      action: "vendor.create",
      resourceType: "vendor",
      resourceId: data.id,
      details: { slug, adapter_key },
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    }).catch(console.error);

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    console.error("vendors POST unexpected:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
