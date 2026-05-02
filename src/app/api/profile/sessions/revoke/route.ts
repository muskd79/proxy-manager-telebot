import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, actorLabel } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";

/**
 * Wave 22F-A — POST /api/profile/sessions/revoke
 *
 * Revoke ALL OTHER sessions for the current admin. The caller's
 * session survives. Useful if the admin suspects credential theft
 * or just wants to log out of an old browser they forgot about.
 *
 * Pre-22F this was coupled to `toggle_admin_active=false` (kicks
 * the user out completely). Now: standalone endpoint, defensible
 * UX, audit trail.
 *
 * Security: any authenticated admin can revoke their OWN sessions.
 * No additional gate (the action only affects them; if their cookie
 * is hijacked, the hijacker can call this on themselves — fine,
 * it just kicks the legitimate user, who sees the audit row and
 * knows to rotate their password).
 */
export async function POST(request: NextRequest) {
  // Wave Phase-1A CSRF guard.
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

  const supabase = await createClient();
  const { admin, error: authError } = await requireAuth(supabase);
  if (authError) return authError;

  // Resolve the auth.users id from the email. We can't get it
  // from the supabase client because the client returns app-level
  // user, not raw auth user, for some endpoints.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(
    user.id,
    "others",
  );

  if (signOutError) {
    console.error("revoke other sessions failed:", signOutError.message);
    return NextResponse.json(
      { success: false, error: "Failed to revoke other sessions" },
      { status: 500 },
    );
  }

  const ipAddress = request.headers.get("x-forwarded-for") || undefined;
  const userAgent = request.headers.get("user-agent") || undefined;

  await logActivity({
    actorType: "admin",
    actorId: admin.id,
    actorDisplayName: actorLabel(admin),
    action: "profile.sessions_revoked",
    resourceType: "admin",
    resourceId: admin.id,
    ipAddress,
    userAgent,
  });

  await supabaseAdmin.from("admin_login_logs").insert({
    admin_id: admin.id,
    email: admin.email,
    action: "session_revoked",
    ip_address: ipAddress,
    user_agent: userAgent,
    details: { scope: "others" },
  });

  return NextResponse.json({
    success: true,
    message: "All other sessions have been revoked.",
  });
}
