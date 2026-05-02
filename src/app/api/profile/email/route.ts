import { createClient } from "@/lib/supabase/server";
import { createClient as createPureClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, actorLabel } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";
import { z } from "zod";

/**
 * Wave 22F-A — POST /api/profile/email
 *
 * Initiate email change. Two phases:
 *   1. THIS endpoint — verifies current password, calls
 *      supabaseAdmin.auth.admin.updateUserById({ email: new_email })
 *      which sends a confirmation link to the NEW email.
 *      admins.pending_email is set so /profile UI can show a banner.
 *   2. User clicks the confirmation link in their inbox; Supabase
 *      moves auth.users.email to the new value. We sync the admins
 *      table via a webhook (Wave 22F-D) or on next /api/profile GET.
 *
 * Security:
 *   - current_password verify (same throwaway-client pattern as
 *     /password route).
 *   - Email format validation.
 *   - Reject if new email is already used by another admin.
 *   - Audit: pending email landed, plus activity log entry.
 *
 * Why phase the change?
 *   Race condition risk: if we just call updateUser and immediately
 *   update admins.email, but the user never clicks confirm, the
 *   user is locked out (joined-by-email lookup fails). Phasing
 *   keeps the existing email valid until confirmation.
 */

const ChangeEmailSchema = z.object({
  current_password: z.string().min(1),
  new_email: z.string().email().max(255),
});

export async function POST(request: NextRequest) {
  // Wave Phase-1A CSRF guard.
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

  const supabase = await createClient();
  const { admin, error: authError } = await requireAuth(supabase);
  if (authError) return authError;

  const body = await request.json();
  const parsed = ChangeEmailSchema.safeParse(body);
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

  const { current_password, new_email } = parsed.data;
  const newEmailLower = new_email.toLowerCase();

  if (newEmailLower === admin.email.toLowerCase()) {
    return NextResponse.json(
      { success: false, error: "New email must differ from current" },
      { status: 400 },
    );
  }

  // Reject if another admin row already owns this email.
  const { data: clash } = await supabaseAdmin
    .from("admins")
    .select("id")
    .eq("email", newEmailLower)
    .maybeSingle();
  if (clash) {
    return NextResponse.json(
      { success: false, error: "This email is already in use by another admin" },
      { status: 409 },
    );
  }

  // Verify current password via throwaway client.
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
      action: "profile.email_change_failed",
      resourceType: "admin",
      resourceId: admin.id,
      details: { reason: "wrong_current_password", attempted_new_email: newEmailLower },
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    });
    return NextResponse.json(
      { success: false, error: "Current password is incorrect" },
      { status: 401 },
    );
  }

  await throwaway.auth.signOut().catch(() => undefined);

  // Trigger Supabase Auth email-change flow. The user receives a
  // confirmation link at the NEW email; clicking it switches
  // auth.users.email to the new value.
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    signInData.user.id,
    { email: newEmailLower },
  );

  if (updateError) {
    console.error("email change failed:", updateError.message);
    return NextResponse.json(
      { success: false, error: updateError.message || "Failed to initiate email change" },
      { status: 500 },
    );
  }

  // Mark pending in admins table for UX.
  await supabaseAdmin
    .from("admins")
    .update({
      pending_email: newEmailLower,
      pending_email_at: new Date().toISOString(),
    })
    .eq("id", admin.id);

  await logActivity({
    actorType: "admin",
    actorId: admin.id,
    actorDisplayName: actorLabel(admin),
    action: "profile.email_change_requested",
    resourceType: "admin",
    resourceId: admin.id,
    details: { from: admin.email, to: newEmailLower },
    ipAddress: request.headers.get("x-forwarded-for") || undefined,
    userAgent: request.headers.get("user-agent") || undefined,
  });

  return NextResponse.json({
    success: true,
    message: `Confirmation link sent to ${newEmailLower}. Click it to complete the change.`,
    pending_email: newEmailLower,
  });
}
