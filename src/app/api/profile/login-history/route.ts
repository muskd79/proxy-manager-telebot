import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

/**
 * Wave 22F-A — GET /api/profile/login-history
 *
 * Returns the last N login_logs rows for the current admin. UI
 * uses this to render the Sessions tab on /profile.
 *
 * Each row: action (login | logout | failed_login | session_revoked
 * | password_changed | 2fa_enabled | 2fa_disabled), ip_address,
 * user_agent, created_at, details JSONB.
 *
 * Read-only; cannot be filtered to other admins (RLS would deny
 * anyway, but the endpoint is self-only by design).
 *
 * Default limit 50, capped at 200. Cursor pagination would replace
 * offset if any single admin's log ever exceeds ~10k rows; not yet
 * realistic at our scale.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAuth(supabase);
  if (authError) return authError;

  const sp = request.nextUrl.searchParams;
  const limit = Math.max(1, Math.min(parseInt(sp.get("limit") || "50") || 50, 200));
  const offset = Math.max(0, parseInt(sp.get("offset") || "0") || 0);

  const { data, error, count } = await supabaseAdmin
    .from("admin_login_logs")
    .select("*", { count: "exact" })
    .eq("admin_id", admin.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("login-history fetch failed:", error.message);
    return NextResponse.json(
      { success: false, error: "Failed to fetch login history" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    data: data ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}
