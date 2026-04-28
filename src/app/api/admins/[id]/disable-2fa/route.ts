import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin, actorLabel } from "@/lib/auth";
import { findAuthUserByEmail } from "@/lib/auth-helpers";
import { logActivity } from "@/lib/logger";

/**
 * Wave 22F-C — POST /api/admins/[id]/disable-2fa
 *
 * Super_admin emergency 2FA reset on another admin. Use case: the
 * target admin lost their phone + all backup codes and is locked
 * out. Super_admin removes their TOTP factors so they can log back
 * in with just email+password, then re-enroll 2FA.
 *
 * Self-target: BLOCKED. The super_admin must use
 * /api/profile/2fa/disable for themselves (which has the proper
 * current-password gate). Allowing self-disable here would let a
 * session-hijacker bypass the password gate.
 *
 * Side effects:
 *   1. All target's TOTP factors unenrolled via Supabase admin API
 *   2. Target's admin_backup_codes rows deleted
 *   3. admins.totp_factor_id + totp_enabled_at cleared
 *   4. ALL target's sessions revoked (signOut "global") — they
 *      must re-login (without 2FA challenge now)
 *   5. Audit + admin_login_logs entry on the TARGET
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireSuperAdmin(supabase);
  if (authError) return authError;

  const { id } = await params;

  if (id === admin.id) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Cannot disable own 2FA via this endpoint — use /profile (current-password gate required for self)",
      },
      { status: 400 },
    );
  }

  const { data: target } = await supabaseAdmin
    .from("admins")
    .select("id, email, totp_enabled_at")
    .eq("id", id)
    .maybeSingle();

  if (!target) {
    return NextResponse.json(
      { success: false, error: "Admin not found" },
      { status: 404 },
    );
  }

  if (!target.totp_enabled_at) {
    return NextResponse.json(
      { success: false, error: "Target admin does not have 2FA enabled" },
      { status: 400 },
    );
  }

  // Wave 22L (C1 fix) — paginated lookup.
  const authUser = await findAuthUserByEmail(target.email);
  if (!authUser) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Admin row exists but no auth.users entry — manual cleanup needed",
      },
      { status: 500 },
    );
  }

  // List + unenroll all factors. Supabase admin API:
  // listFactors(userId) returns { factors: Factor[] }; unenroll
  // by ID one-by-one.
  const { data: factorList } = await supabaseAdmin.auth.admin.mfa.listFactors({
    userId: authUser.id,
  });
  for (const f of factorList?.factors ?? []) {
    await supabaseAdmin.auth.admin.mfa
      .deleteFactor({ userId: authUser.id, id: f.id })
      .catch((e) => {
        console.error(`unenroll factor ${f.id} failed:`, e);
      });
  }

  // Wipe backup codes.
  await supabaseAdmin
    .from("admin_backup_codes")
    .delete()
    .eq("admin_id", id);

  // Clear admins flags.
  await supabaseAdmin
    .from("admins")
    .update({ totp_factor_id: null, totp_enabled_at: null })
    .eq("id", id);

  // Revoke target's sessions globally — they must re-auth.
  await supabaseAdmin.auth.admin.signOut(authUser.id, "global").catch((e) => {
    console.error("post-disable-2fa signOut failed:", e);
  });

  const ipAddress = request.headers.get("x-forwarded-for") || undefined;
  const userAgent = request.headers.get("user-agent") || undefined;

  await logActivity({
    actorType: "admin",
    actorId: admin.id,
    actorDisplayName: actorLabel(admin),
    action: "admin.2fa_force_disabled",
    resourceType: "admin",
    resourceId: id,
    details: { target_email: target.email },
    ipAddress,
    userAgent,
  });

  await supabaseAdmin.from("admin_login_logs").insert({
    admin_id: id,
    email: target.email,
    action: "2fa_disabled",
    ip_address: ipAddress,
    user_agent: userAgent,
    details: { force_disabled_by: admin.email },
  });

  return NextResponse.json({
    success: true,
    message: `2FA forcibly disabled on ${target.email}. They were signed out globally and must re-login.`,
  });
}
