import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin, actorLabel } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { randomBytes } from "crypto";
import { z } from "zod";

/**
 * Wave 22F-C — POST /api/admins/[id]/reset-password
 *
 * Super_admin force-resets another admin's password. Use cases:
 *   - Admin forgot password and Supabase email reset isn't reaching
 *     them
 *   - Account compromise — rotate immediately
 *   - Onboarding handoff
 *
 * Modes:
 *   { generate: true }                   → backend generates 16-char
 *                                          random password, returns it
 *                                          ONCE so the super_admin
 *                                          communicates OOB
 *   { new_password: "<>=12 chars>" }     → super_admin sets a specific
 *                                          password
 *
 * After reset:
 *   1. Auth password updated via supabaseAdmin.auth.admin.updateUserById
 *   2. ALL of the target's sessions revoked (signOut("global"))
 *   3. admins.password_changed_at bumped on the target
 *   4. Dual audit (activity_logs + admin_login_logs)
 *
 * Self-target: ALLOWED but discouraged — use /api/profile/password
 * with the current-password flow instead. We don't block self
 * because edge case: a super_admin who forgot their own password
 * may be the only super_admin and needs to recover via... wait,
 * they can't reach this endpoint without a session. So self-target
 * is functionally a no-op security-wise. Allow it as a convenience.
 */

const ResetPasswordSchema = z.union([
  z.object({ generate: z.literal(true) }),
  z.object({
    new_password: z
      .string()
      .min(12, "Password must be at least 12 characters")
      .max(128),
  }),
]);

function generatePassword(): string {
  // 16-char URL-safe random string. Easy to communicate over chat.
  return randomBytes(12).toString("base64url").slice(0, 16);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireSuperAdmin(supabase);
  if (authError) return authError;

  const { id } = await params;

  const parsed = ResetPasswordSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Body must be { generate: true } OR { new_password: string >= 12 chars }",
      },
      { status: 400 },
    );
  }

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

  // Resolve auth.users id by email.
  const { data: usersList } = await supabaseAdmin.auth.admin.listUsers();
  const authUser = usersList?.users.find((u) => u.email === target.email);
  if (!authUser) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Admin row exists but no matching auth.users entry — manual cleanup needed",
      },
      { status: 500 },
    );
  }

  const newPassword =
    "generate" in parsed.data ? generatePassword() : parsed.data.new_password;

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    authUser.id,
    { password: newPassword },
  );
  if (updateError) {
    return NextResponse.json(
      { success: false, error: updateError.message },
      { status: 500 },
    );
  }

  // Force-revoke ALL sessions of the target — they must re-login
  // with the new password. This includes the super_admin's session
  // ONLY if they're targeting themselves; otherwise unrelated.
  await supabaseAdmin.auth.admin.signOut(authUser.id, "global").catch((e) => {
    console.error("post-reset signOut failed:", e);
  });

  // Bump password_changed_at on the target's admins row.
  await supabaseAdmin
    .from("admins")
    .update({ password_changed_at: new Date().toISOString() })
    .eq("id", id);

  const ipAddress = request.headers.get("x-forwarded-for") || undefined;
  const userAgent = request.headers.get("user-agent") || undefined;

  await logActivity({
    actorType: "admin",
    actorId: admin.id,
    actorDisplayName: actorLabel(admin),
    action: "admin.password_reset",
    resourceType: "admin",
    resourceId: id,
    details: {
      target_email: target.email,
      mode: "generate" in parsed.data ? "generate" : "set",
      // NEVER include the password in details — would leak in logs
    },
    ipAddress,
    userAgent,
  });

  await supabaseAdmin.from("admin_login_logs").insert({
    admin_id: id,
    email: target.email,
    action: "password_changed",
    ip_address: ipAddress,
    user_agent: userAgent,
    details: { reset_by: admin.email },
  });

  return NextResponse.json({
    success: true,
    message: `Password reset for ${target.email}. Existing sessions revoked.`,
    // Only return the password if super_admin asked us to generate it.
    // If they passed their own, no need to echo it back.
    new_password: "generate" in parsed.data ? newPassword : undefined,
  });
}
