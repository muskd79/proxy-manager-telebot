import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireAnyRole, requireSuperAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { listAdapterKeys } from "@/lib/vendors/registry";
import { assertSameOrigin } from "@/lib/csrf";
import { assertPublicHost, SsrfBlockedError } from "@/lib/security/public-ip";

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
      .select(
        "id, slug, display_name, status, base_url, adapter_key, default_currency, support_email, rate_limit_rpm, notes, created_at, updated_at",
      )
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
    console.error("vendors GET unexpected:", (error as Error)?.message);
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
 * Super-admin only: vendor setup establishes a billing relationship.
 * CSRF-protected: verifies Origin / Referer against the app allowlist.
 * base_url SSRF-checked: rejects attacker-controlled hosts that would
 * cause the adapter to exfiltrate decrypted API keys to external servers.
 */
export async function POST(request: NextRequest) {
  // 1. CSRF boundary — reject cross-origin mutations before auth lookup.
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

  // 2. Super-admin only. Vendor setup = billing-sensitive, not ordinary admin.
  const supabase = await createClient();
  const { admin, error: authError } = await requireSuperAdmin(supabase);
  if (authError) return authError;

  try {
    const body = await request.json();
    const {
      slug,
      display_name,
      base_url,
      adapter_key,
      support_email,
      rate_limit_rpm,
      notes,
    } = body ?? {};

    if (!slug || !display_name || !base_url || !adapter_key) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Missing required fields: slug, display_name, base_url, adapter_key",
        },
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

    // 3. base_url SSRF check. An attacker who can write this field would
    // otherwise get the decrypted API key POST'd to their server the next
    // time the adapter calls vendorFetch.
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(base_url);
    } catch {
      return NextResponse.json(
        { success: false, error: "base_url must be a valid absolute URL" },
        { status: 400 },
      );
    }
    if (parsedUrl.protocol !== "https:") {
      return NextResponse.json(
        { success: false, error: "base_url must use https://" },
        { status: 400 },
      );
    }
    try {
      await assertPublicHost(parsedUrl.hostname);
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        return NextResponse.json(
          {
            success: false,
            error: `base_url host rejected (${err.reason})`,
          },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { success: false, error: "Failed to resolve base_url host" },
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
      details: { slug, adapter_key, base_url },
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    }).catch((e) =>
      console.error(
        "vendor.create log failed:",
        e instanceof Error ? e.message : String(e),
      ),
    );

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    console.error(
      "vendors POST unexpected:",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
