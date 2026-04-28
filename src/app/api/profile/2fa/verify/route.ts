import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, actorLabel } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { generateBackupCodes } from "@/lib/backup-codes";
import { z } from "zod";

/**
 * Wave 22F-B — POST /api/profile/2fa/verify
 *
 * Confirms 2FA enrollment by validating a TOTP code, then:
 *   1. Marks admins.totp_factor_id + totp_enabled_at
 *   2. Generates 8 single-use backup codes (sha256 + per-code salt)
 *   3. Stores hashed codes in admin_backup_codes
 *   4. Returns the PLAIN TEXT codes — shown ONCE; user must save them
 *
 * If the user calls /verify a second time, no new backup codes are
 * generated (idempotent). They can regenerate via /backup-codes/
 * regenerate which requires the current password.
 *
 * Security:
 *   - Validates the factor_id belongs to the calling user (Supabase
 *     enforces this via session-bound mfa.challengeAndVerify).
 *   - 6-digit numeric TOTP code only.
 *   - Activity log + admin_login_logs both record the enable event.
 */

const VerifySchema = z.object({
  factor_id: z.string().uuid("factor_id must be a UUID"),
  code: z
    .string()
    .regex(/^\d{6}$/, "TOTP code must be 6 digits"),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAuth(supabase);
  if (authError) return authError;

  const body = await request.json();
  const parsed = VerifySchema.safeParse(body);
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

  const { factor_id, code } = parsed.data;

  // Supabase's challengeAndVerify combines challenge + verify into
  // one call so callers don't have to pass challenge_id around.
  const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor_id,
    code,
  });

  if (verifyError) {
    await logActivity({
      actorType: "admin",
      actorId: admin.id,
      actorDisplayName: actorLabel(admin),
      action: "profile.2fa_verify_failed",
      resourceType: "admin",
      resourceId: admin.id,
      details: { reason: verifyError.message },
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    });
    return NextResponse.json(
      { success: false, error: "Invalid TOTP code" },
      { status: 401 },
    );
  }

  // Mark on the admins row.
  await supabaseAdmin
    .from("admins")
    .update({
      totp_factor_id: factor_id,
      totp_enabled_at: new Date().toISOString(),
    })
    .eq("id", admin.id);

  // Generate backup codes if not already present (idempotent).
  const { data: existing } = await supabaseAdmin
    .from("admin_backup_codes")
    .select("id")
    .eq("admin_id", admin.id)
    .is("used_at", null)
    .limit(1);

  let plaintextCodes: string[] = [];

  if (!existing || existing.length === 0) {
    const codes = generateBackupCodes(8);
    plaintextCodes = codes.map((c) => c.code);

    const { error: insertError } = await supabaseAdmin
      .from("admin_backup_codes")
      .insert(
        codes.map((c) => ({
          admin_id: admin.id,
          code_hash: c.code_hash,
          salt: c.salt,
        })),
      );

    if (insertError) {
      console.error("backup codes insert failed:", insertError.message);
      // Non-fatal: 2FA is enabled, codes failed. User can regenerate.
    }
  }

  const ipAddress = request.headers.get("x-forwarded-for") || undefined;
  const userAgent = request.headers.get("user-agent") || undefined;

  await logActivity({
    actorType: "admin",
    actorId: admin.id,
    actorDisplayName: actorLabel(admin),
    action: "profile.2fa_enabled",
    resourceType: "admin",
    resourceId: admin.id,
    ipAddress,
    userAgent,
  });

  await supabaseAdmin.from("admin_login_logs").insert({
    admin_id: admin.id,
    email: admin.email,
    action: "2fa_enabled",
    ip_address: ipAddress,
    user_agent: userAgent,
  });

  return NextResponse.json({
    success: true,
    message: "2FA enabled. Save the backup codes below — shown once only.",
    data: {
      backup_codes: plaintextCodes,
      backup_codes_already_existed: plaintextCodes.length === 0,
    },
  });
}
