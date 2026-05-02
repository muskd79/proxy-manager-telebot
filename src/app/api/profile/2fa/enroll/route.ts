import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, actorLabel } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";

/**
 * Wave 22F-B — POST /api/profile/2fa/enroll
 *
 * Begin TOTP enrollment via Supabase Auth MFA. Returns:
 *   - factor_id     — caller passes this back to /verify
 *   - qr_code       — data: URI for an authenticator-app QR
 *   - secret        — base32 secret for manual entry
 *   - uri           — otpauth:// URI for direct deep-link
 *
 * The factor is in UNVERIFIED state until the user enters a TOTP
 * code at /api/profile/2fa/verify. Until then it does NOT count
 * as 2FA being enabled — the user can still log in without TOTP.
 *
 * If a verified factor already exists, this returns 409. The user
 * must disable the existing factor first via /disable.
 */
export async function POST(request: NextRequest) {
  // Wave Phase-1A CSRF guard.
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

  const supabase = await createClient();
  const { admin, error: authError } = await requireAuth(supabase);
  if (authError) return authError;

  // Block if a verified factor already exists.
  // Supabase types `Factor.status` as the string literal "verified", but
  // the runtime value is "verified" | "unverified". Cast to the wider
  // string for comparison.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const totpFactors = (factors?.totp ?? []) as Array<{ id: string; status: string }>;
  const verified = totpFactors.find((f) => f.status === "verified");
  if (verified) {
    return NextResponse.json(
      {
        success: false,
        error: "2FA is already enabled. Disable it first to re-enroll.",
        existing_factor_id: verified.id,
      },
      { status: 409 },
    );
  }

  // Clean up any prior unverified factors so the user can restart.
  // Supabase keeps unverified factors around indefinitely; we don't.
  for (const f of totpFactors) {
    if (f.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `proxy-manager-${admin.email}`,
  });

  if (error || !data) {
    console.error("mfa.enroll failed:", error?.message);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to start enrollment" },
      { status: 500 },
    );
  }

  await logActivity({
    actorType: "admin",
    actorId: admin.id,
    actorDisplayName: actorLabel(admin),
    action: "profile.2fa_enroll_started",
    resourceType: "admin",
    resourceId: admin.id,
    ipAddress: request.headers.get("x-forwarded-for") || undefined,
    userAgent: request.headers.get("user-agent") || undefined,
  });

  return NextResponse.json({
    success: true,
    data: {
      factor_id: data.id,
      qr_code: data.totp.qr_code,
      secret: data.totp.secret,
      uri: data.totp.uri,
    },
  });
}
