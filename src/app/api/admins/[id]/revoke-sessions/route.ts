import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin, actorLabel } from "@/lib/auth";
import { findAuthUserByEmail } from "@/lib/auth-helpers";
import { logActivity } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";

/**
 * Wave 22F-C — POST /api/admins/[id]/revoke-sessions
 *
 * Super_admin force-logout one specific admin. Use case: incident
 * response (suspected compromise, terminated employee) without
 * deactivating their account.
 *
 * Self-target: redirects logically to /api/profile/sessions/revoke
 * which kills OTHER sessions (caller's survives). This endpoint
 * unconditionally kills ALL sessions of the target — that's the
 * point. So self-target is allowed but the caller WILL be logged
 * out as a side-effect.
 *
 * Difference vs toggle_admin_active=false (in /api/settings):
 *   - That deactivates the account; getAdmin() returns null,
 *     login fails. This is a HEAVIER action, often unwanted.
 *   - This endpoint just kills sessions; account stays active.
 *     User can log back in immediately.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Wave Phase-1A CSRF guard.
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

  const supabase = await createClient();
  const { admin, error: authError } = await requireSuperAdmin(supabase);
  if (authError) return authError;

  const { id } = await params;

  const { data: target } = await supabaseAdmin
    .from("admins")
    .select("id, email")
    .eq("id", id)
    .maybeSingle();

  if (!target) {
    return NextResponse.json(
      { success: false, error: "Admin not found" },
      { status: 404 },
    );
  }

  // Wave 22L (C1 fix) — paginated lookup.
  const authUser = await findAuthUserByEmail(target.email);
  if (!authUser) {
    return NextResponse.json(
      {
        success: false,
        error: "No auth.users row for this admin — sessions cannot be revoked",
      },
      { status: 500 },
    );
  }

  const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(
    authUser.id,
    "global",
  );
  if (signOutError) {
    return NextResponse.json(
      { success: false, error: signOutError.message },
      { status: 500 },
    );
  }

  const ipAddress = request.headers.get("x-forwarded-for") || undefined;
  const userAgent = request.headers.get("user-agent") || undefined;

  await logActivity({
    actorType: "admin",
    actorId: admin.id,
    actorDisplayName: actorLabel(admin),
    action: "admin.sessions_force_revoked",
    resourceType: "admin",
    resourceId: id,
    details: { target_email: target.email, scope: "global" },
    ipAddress,
    userAgent,
  });

  await supabaseAdmin.from("admin_login_logs").insert({
    admin_id: id,
    email: target.email,
    action: "session_revoked",
    ip_address: ipAddress,
    user_agent: userAgent,
    details: { scope: "global", revoked_by: admin.email },
  });

  return NextResponse.json({
    success: true,
    message: `All sessions for ${target.email} have been revoked.`,
  });
}
