import { createClient } from "@/lib/supabase/server";
import { createClient as createPureClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, actorLabel } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";
import { z } from "zod";

/**
 * Wave 22F-A — POST /api/profile/password
 *
 * Server-side password change. REPLACES the unsafe pre-22F flow that
 * called `supabase.auth.updateUser({ password })` directly from
 * /profile/page.tsx — no audit, no current-password verify, no
 * session revocation.
 *
 * Security model (mirrors VIA project's pattern):
 *   1. Caller must be authenticated.
 *   2. `current_password` is verified by spinning up a throwaway
 *      Supabase client and attempting signInWithPassword. We discard
 *      that throwaway session immediately. No persistence.
 *   3. New password set via `supabaseAdmin.auth.admin.updateUserById`.
 *   4. All OTHER sessions for this user are revoked via
 *      `supabaseAdmin.auth.admin.signOut(userId, "others")` — keeps
 *      the caller's current session alive but kicks the attacker
 *      from any concurrent session they might own.
 *   5. admins.password_changed_at is bumped (mig 035).
 *   6. activity_logs + admin_login_logs both record the event with
 *      the actor's IP + user-agent.
 *
 * Rate limit: this endpoint is sensitive and Supabase Auth itself
 * rate-limits at ~30 req/hr/email. We rely on that as the outer
 * gate; in-app gating would be a Wave 23+ enhancement.
 */

const ChangePasswordSchema = z.object({
  current_password: z.string().min(1, "current_password required"),
  new_password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(128, "Password too long"),
});

export async function POST(request: NextRequest) {
  // Wave Phase-1A CSRF guard.
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

  const supabase = await createClient();
  const { admin, error: authError } = await requireAuth(supabase);
  if (authError) return authError;

  const body = await request.json();
  const parsed = ChangePasswordSchema.safeParse(body);
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

  const { current_password, new_password } = parsed.data;

  // Don't let the user "change" to the same password — wastes the
  // session-revoke step and creates a misleading audit row.
  if (current_password === new_password) {
    return NextResponse.json(
      { success: false, error: "New password must differ from current" },
      { status: 400 },
    );
  }

  // Step 1: verify current_password via throwaway sign-in.
  // We use a pure client (no cookie persistence) so the verification
  // does not affect the caller's actual session.
  const throwaway = createPureClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: signInData, error: signInError } =
    await throwaway.auth.signInWithPassword({
      email: admin.email,
      password: current_password,
    });

  if (signInError || !signInData.user) {
    // Audit failed attempt — incident response signal.
    await logActivity({
      actorType: "admin",
      actorId: admin.id,
      actorDisplayName: actorLabel(admin),
      action: "profile.password_change_failed",
      resourceType: "admin",
      resourceId: admin.id,
      details: { reason: "wrong_current_password" },
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    });
    return NextResponse.json(
      { success: false, error: "Current password is incorrect" },
      { status: 401 },
    );
  }

  // Discard the throwaway session immediately.
  await throwaway.auth.signOut().catch(() => {
    /* best-effort cleanup; the session has no persistence anyway */
  });

  // Step 2: set new password via admin API.
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    signInData.user.id,
    { password: new_password },
  );

  if (updateError) {
    console.error("password update failed:", updateError.message);
    return NextResponse.json(
      { success: false, error: "Failed to update password" },
      { status: 500 },
    );
  }

  // Step 3: revoke all OTHER sessions. Caller's session survives.
  await supabaseAdmin.auth.admin.signOut(signInData.user.id, "others").catch(
    (e) => {
      // Non-fatal: password is already changed. Log and continue.
      console.error("signOut(others) failed:", e);
    },
  );

  // Step 4: bump admins.password_changed_at.
  await supabaseAdmin
    .from("admins")
    .update({ password_changed_at: new Date().toISOString() })
    .eq("id", admin.id);

  // Step 5: dual audit (activity_logs + admin_login_logs).
  const ipAddress = request.headers.get("x-forwarded-for") || undefined;
  const userAgent = request.headers.get("user-agent") || undefined;

  await logActivity({
    actorType: "admin",
    actorId: admin.id,
    actorDisplayName: actorLabel(admin),
    action: "profile.password_changed",
    resourceType: "admin",
    resourceId: admin.id,
    ipAddress,
    userAgent,
  });

  await supabaseAdmin.from("admin_login_logs").insert({
    admin_id: admin.id,
    email: admin.email,
    action: "password_changed",
    ip_address: ipAddress,
    user_agent: userAgent,
  });

  return NextResponse.json({
    success: true,
    message: "Password changed. Other sessions have been signed out.",
  });
}
