import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { findAuthUserByEmail } from "@/lib/auth-helpers";
import { verifyBackupCode, normaliseBackupInput } from "@/lib/backup-codes";
import { logActivity } from "@/lib/logger";
import { checkApiRateLimit } from "@/lib/rate-limiter";
import { getClientIp } from "@/lib/ip";
import { z } from "zod";

/**
 * Wave 22L (Phase 1 — C2 fix) — POST /api/auth/recover-2fa
 *
 * Public endpoint (NO auth required) for the 2FA emergency recovery
 * flow. Fixes the lockout scenario the UI/UX agent flagged:
 * "If only 1 super_admin exists and they lose 2FA, permanent lockout."
 *
 * Flow (the route):
 *   1. User goes to /auth/recover-2fa, enters email + backup_code +
 *      current_password.
 *   2. We verify all three:
 *      - email matches an admin row
 *      - current_password verifies via signInWithPassword (throwaway)
 *      - backup_code matches an UNUSED row in admin_backup_codes
 *   3. On success:
 *      - Mark the backup code as used (used_at = now)
 *      - Unenroll all TOTP factors via supabaseAdmin.auth.admin.mfa
 *      - Clear admins.totp_factor_id + totp_enabled_at
 *      - Audit log
 *   4. User signs in normally next time without 2FA challenge.
 *      They can re-enroll 2FA from /profile.
 *
 * Why all 3 factors required (NOT just backup code)?
 *   - Backup codes alone could be stolen (printed paper, password
 *     manager export). Pairing with current_password ensures
 *     attacker also has the password.
 *   - Email lookup binds the recovery to one specific account.
 *
 * Rate limiting: relies on Supabase Auth's own throttle on
 * signInWithPassword (~5 attempts/minute by default). Failed attempts
 * audit to admin_login_logs so ops can detect brute-force.
 *
 * Why not require admin to be ALREADY LOGGED IN?
 *   - That's the whole point: they CAN'T log in (2FA challenge blocks
 *     them after password). So this endpoint is purposefully
 *     unauthenticated except for the 3 factors above.
 */

const RecoverSchema = z.object({
  email: z.string().email().max(255),
  current_password: z.string().min(1),
  backup_code: z.string().min(1).max(100),
});

export async function POST(request: NextRequest) {
  // Wave 23A — IP rate limit for unauthenticated 2FA recovery.
  // Without this, an attacker who guessed the email + has lots of
  // backup-code candidates could brute-force without any throttle.
  // The API rate limiter is fail-closed, so DB-down means HTTP 429
  // — preferable to letting recovery requests through unchecked.
  const ip = getClientIp(request);
  const rl = await checkApiRateLimit(`recover2fa:${ip}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Quá nhiều lần thử. Đợi vài phút rồi thử lại." },
      { status: 429 },
    );
  }

  const parsed = RecoverSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Email + mật khẩu + mã backup là bắt buộc" },
      { status: 400 },
    );
  }

  const { email, current_password, backup_code } = parsed.data;
  const emailLower = email.toLowerCase();
  const ipAddress = request.headers.get("x-forwarded-for") || undefined;
  const userAgent = request.headers.get("user-agent") || undefined;

  // Step 1: lookup admin row.
  const { data: admin } = await supabaseAdmin
    .from("admins")
    .select("id, email, full_name, totp_enabled_at")
    .eq("email", emailLower)
    .eq("is_active", true)
    .maybeSingle();

  if (!admin) {
    // Audit failed attempt (admin_id NULL)
    await supabaseAdmin.from("admin_login_logs").insert({
      admin_id: null,
      email: emailLower,
      action: "failed_login",
      ip_address: ipAddress,
      user_agent: userAgent,
      details: { reason: "recover_2fa_no_admin" },
    });
    return NextResponse.json(
      {
        success: false,
        error:
          "Thông tin không khớp. Kiểm tra email + mật khẩu + mã backup.",
      },
      { status: 401 },
    );
  }

  if (!admin.totp_enabled_at) {
    return NextResponse.json(
      {
        success: false,
        error: "Tài khoản này chưa bật 2FA — không cần dùng recovery.",
      },
      { status: 400 },
    );
  }

  // Step 2: verify password via throwaway client.
  const { createClient: createPureClient } = await import("@supabase/supabase-js");
  const throwaway = createPureClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: signInData, error: signInError } =
    await throwaway.auth.signInWithPassword({
      email: emailLower,
      password: current_password,
    });

  if (signInError || !signInData.user) {
    await supabaseAdmin.from("admin_login_logs").insert({
      admin_id: admin.id,
      email: emailLower,
      action: "failed_login",
      ip_address: ipAddress,
      user_agent: userAgent,
      details: { reason: "recover_2fa_wrong_password" },
    });
    return NextResponse.json(
      { success: false, error: "Thông tin không khớp." },
      { status: 401 },
    );
  }

  // Discard throwaway session.
  await throwaway.auth.signOut().catch(() => undefined);

  // Step 3: validate backup code against unused rows.
  const normalised = normaliseBackupInput(backup_code);
  const { data: codes } = await supabaseAdmin
    .from("admin_backup_codes")
    .select("id, code_hash, salt, used_at")
    .eq("admin_id", admin.id)
    .is("used_at", null);

  if (!codes || codes.length === 0) {
    await logActivity({
      actorType: "admin",
      actorId: admin.id,
      actorDisplayName: admin.full_name || admin.email,
      action: "auth.recover_2fa_failed",
      resourceType: "admin",
      resourceId: admin.id,
      details: { reason: "no_codes_left" },
      ipAddress,
      userAgent,
    });
    return NextResponse.json(
      {
        success: false,
        error:
          "Đã dùng hết mã backup. Liên hệ super_admin khác để reset 2FA.",
      },
      { status: 400 },
    );
  }

  let matched: (typeof codes)[number] | null = null;
  for (const c of codes) {
    if (verifyBackupCode(normalised, c.salt, c.code_hash)) {
      matched = c;
      break;
    }
  }

  if (!matched) {
    await logActivity({
      actorType: "admin",
      actorId: admin.id,
      actorDisplayName: admin.full_name || admin.email,
      action: "auth.recover_2fa_failed",
      resourceType: "admin",
      resourceId: admin.id,
      details: { reason: "invalid_backup_code" },
      ipAddress,
      userAgent,
    });
    return NextResponse.json(
      { success: false, error: "Mã backup không hợp lệ." },
      { status: 401 },
    );
  }

  // Step 4: mark backup code used (so attacker who later steals it
  // can't replay).
  await supabaseAdmin
    .from("admin_backup_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", matched.id);

  // Step 5: unenroll all TOTP factors via admin API.
  const authUser = await findAuthUserByEmail(emailLower);
  if (authUser) {
    const { data: factorList } = await supabaseAdmin.auth.admin.mfa.listFactors({
      userId: authUser.id,
    });
    for (const f of factorList?.factors ?? []) {
      await supabaseAdmin.auth.admin.mfa
        .deleteFactor({ userId: authUser.id, id: f.id })
        .catch((e) => {
          console.error(`recover-2fa: unenroll factor ${f.id} failed:`, e);
        });
    }
  }

  // Step 6: clear admins flags.
  await supabaseAdmin
    .from("admins")
    .update({ totp_factor_id: null, totp_enabled_at: null })
    .eq("id", admin.id);

  // Step 7: audit.
  await logActivity({
    actorType: "admin",
    actorId: admin.id,
    actorDisplayName: admin.full_name || admin.email,
    action: "auth.recover_2fa_success",
    resourceType: "admin",
    resourceId: admin.id,
    details: { remaining_codes: codes.length - 1 },
    ipAddress,
    userAgent,
  });

  await supabaseAdmin.from("admin_login_logs").insert({
    admin_id: admin.id,
    email: emailLower,
    action: "2fa_disabled",
    ip_address: ipAddress,
    user_agent: userAgent,
    details: { recovered_via: "backup_code" },
  });

  return NextResponse.json({
    success: true,
    message:
      "Đã gỡ 2FA. Đăng nhập lại bằng email + mật khẩu (không cần mã 6 số). Sau đó vào /profile để bật lại 2FA và lưu mã backup mới.",
  });
}
