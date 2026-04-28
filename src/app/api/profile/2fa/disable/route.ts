import { createClient } from "@/lib/supabase/server";
import { createClient as createPureClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, actorLabel } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { z } from "zod";

/**
 * Wave 22F-B — POST /api/profile/2fa/disable
 *
 * Disable 2FA self-service. Requires CURRENT PASSWORD as a gate so
 * a session hijacker can't unlock the account by removing 2FA.
 *
 * Steps:
 *   1. Verify current_password (throwaway client, same pattern as
 *      /api/profile/password).
 *   2. Iterate all TOTP factors for this user, unenroll each.
 *   3. Delete admin_backup_codes rows.
 *   4. Clear admins.totp_factor_id + totp_enabled_at.
 *   5. Audit + admin_login_logs.
 */

const DisableSchema = z.object({
  current_password: z.string().min(1, "current_password required"),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAuth(supabase);
  if (authError) return authError;

  const body = await request.json();
  const parsed = DisableSchema.safeParse(body);
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

  const { current_password } = parsed.data;

  // Step 1: verify current password via throwaway pure client.
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
    await logActivity({
      actorType: "admin",
      actorId: admin.id,
      actorDisplayName: actorLabel(admin),
      action: "profile.2fa_disable_failed",
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
  await throwaway.auth.signOut().catch(() => undefined);

  // Step 2: unenroll every TOTP factor (verified or not).
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.totp ?? []) {
    await supabase.auth.mfa.unenroll({ factorId: f.id });
  }

  // Step 3: delete backup codes.
  await supabaseAdmin
    .from("admin_backup_codes")
    .delete()
    .eq("admin_id", admin.id);

  // Step 4: clear admins flags.
  await supabaseAdmin
    .from("admins")
    .update({
      totp_factor_id: null,
      totp_enabled_at: null,
    })
    .eq("id", admin.id);

  const ipAddress = request.headers.get("x-forwarded-for") || undefined;
  const userAgent = request.headers.get("user-agent") || undefined;

  await logActivity({
    actorType: "admin",
    actorId: admin.id,
    actorDisplayName: actorLabel(admin),
    action: "profile.2fa_disabled",
    resourceType: "admin",
    resourceId: admin.id,
    ipAddress,
    userAgent,
  });

  await supabaseAdmin.from("admin_login_logs").insert({
    admin_id: admin.id,
    email: admin.email,
    action: "2fa_disabled",
    ip_address: ipAddress,
    user_agent: userAgent,
  });

  return NextResponse.json({
    success: true,
    message: "2FA disabled. Re-enroll any time from /profile.",
  });
}
