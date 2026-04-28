import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrAbove, requireAnyRole, actorLabel } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";
import { ImportLotPayloadSchema, type ImportLotResult } from "@/lib/lots/import-payload";
import type { PurchaseLot } from "@/types/database";

/**
 * GET /api/lots
 * List purchase lots with optional ?vendor=&from=&to= filters and
 * cursor pagination (?limit=50&offset=0). Read-only — any role.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  const { searchParams } = request.nextUrl;
  const vendor = searchParams.get("vendor");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 200);
  const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);

  try {
    let q = supabase
      .from("purchase_lots")
      .select(
        "id, vendor_label, purchase_date, expiry_date, total_cost_usd, currency, source_file_name, batch_reference, proxy_count, parent_lot_id, notes, created_at, updated_at",
        { count: "estimated" },
      )
      .order("purchase_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (vendor) q = q.eq("vendor_label", vendor);
    if (from) q = q.gte("purchase_date", from);
    if (to) q = q.lte("purchase_date", to);

    const { data, count, error } = await q;
    if (error) {
      console.error("lots list error:", error.message);
      return NextResponse.json(
        { success: false, error: "Failed to list lots" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: (data ?? []) as PurchaseLot[],
      meta: { total: count ?? 0, limit, offset },
    });
  } catch (err) {
    console.error("lots GET unexpected:", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/lots
 * Atomic lot+proxies import via the import_lot RPC. Body:
 *   { idempotency_key: UUIDv7, lot: {...}, proxies: [{...}, ...] }
 *
 * Idempotent: re-submitting with the same key returns the existing
 * lot's summary with deduplicated=true. Admin+ only; CSRF-protected.
 *
 * Status codes:
 *   201 — new lot created
 *   200 — existing lot returned (idempotent retry)
 *   400 — validation error / bad JSON
 *   403 — non-admin / cross-origin
 *   500 — RPC error / DB unavailable
 */
export async function POST(request: NextRequest) {
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

  const supabase = await createClient();
  const { admin, error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  try {
    const body = await request.json();
    const parsed = ImportLotPayloadSchema.safeParse(body);
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

    const { idempotency_key, lot, proxies } = parsed.data;

    const { data, error } = await supabaseAdmin.rpc("import_lot", {
      p_idempotency_key: idempotency_key,
      p_lot: lot,
      p_proxies: proxies,
      p_admin_id: admin.id,
    });

    if (error) {
      console.error("import_lot RPC error:", error.message);
      return NextResponse.json(
        { success: false, error: "Import failed", details: error.message },
        { status: 500 },
      );
    }

    const result = data as unknown as ImportLotResult;

    logActivity({
      actorType: "admin",
      actorId: admin.id,
      actorDisplayName: actorLabel(admin),
      action: result.deduplicated ? "lot.import.dedup" : "lot.import.create",
      resourceType: "purchase_lot",
      resourceId: result.lot_id,
      details: {
        vendor: lot.vendor_label,
        proxy_count: proxies.length,
        inserted: result.inserted_proxies,
        updated: result.updated_proxies,
      },
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    }).catch((e) =>
      console.error(
        "lot.import log failed:",
        e instanceof Error ? e.message : String(e),
      ),
    );

    return NextResponse.json(
      { success: true, data: result },
      { status: result.deduplicated ? 200 : 201 },
    );
  } catch (err) {
    console.error("lots POST unexpected:", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
