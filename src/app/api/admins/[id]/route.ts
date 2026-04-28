import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin, actorLabel } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { z } from "zod";

/**
 * Wave 22F-C — /api/admins/[id]
 *
 * Super-admin endpoints for managing OTHER admins.
 *   GET  : fetch single admin row (super_admin only)
 *   PUT  : update profile (full_name, telegram_id, role, language)
 *   DELETE: hard-delete (with self-target + last-super-admin guards)
 *
 * Email is NOT editable here (separate flow needed — auth.users
 * mutation requires the user to confirm via emailed link). For
 * super_admin "I need to reset Bob's email RIGHT NOW", use the
 * dedicated /api/admins/[id]/email route in a follow-up sub-wave.
 *
 * Self-management overlap:
 *   - Self profile edit → use /api/profile (PUT)
 *   - Self password change → /api/profile/password
 *   - Self 2FA → /api/profile/2fa/*
 *   This route exists exclusively for super_admin acting on OTHERS.
 */

const UpdateAdminSchema = z.object({
  full_name: z.string().max(100).nullable().optional(),
  telegram_id: z.coerce.number().int().positive().nullable().optional(),
  language: z.enum(["vi", "en"]).optional(),
  // role + is_active stay in /api/settings for now (Wave 22D-3 had
  // self-target guards there). A future wave consolidates.
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireSuperAdmin(supabase);
  if (authError) return authError;

  const { id } = await params;

  // Wave 22F-C: include the new lifecycle columns (totp + login + lockout).
  const { data, error } = await supabaseAdmin
    .from("admins")
    .select(
      "id, email, full_name, role, is_active, language, telegram_id, last_login_at, last_login_ip, login_count, totp_enabled_at, password_changed_at, pending_email, pending_email_at, locked_until, lockout_reason, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { success: false, error: "Admin not found" },
      { status: 404 },
    );
  }

  // Audit the view — super_admin reading another admin's full
  // profile is a sensitive op (sees totp_enabled_at, IP, etc).
  // Skip self-views to keep the log clean.
  if (admin.id !== id) {
    await logActivity({
      actorType: "admin",
      actorId: admin.id,
      actorDisplayName: actorLabel(admin),
      action: "admin.profile_viewed",
      resourceType: "admin",
      resourceId: id,
    });
  }

  return NextResponse.json({ success: true, data });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireSuperAdmin(supabase);
  if (authError) return authError;

  const { id } = await params;

  const parsed = UpdateAdminSchema.safeParse(await request.json());
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

  const { data, error } = await supabaseAdmin
    .from("admins")
    .update(parsed.data)
    .eq("id", id)
    .select(
      "id, email, full_name, role, is_active, language, telegram_id",
    )
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { success: false, error: "Telegram ID already used by another admin" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { success: false, error: error.message || "Failed to update admin" },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { success: false, error: "Admin not found" },
      { status: 404 },
    );
  }

  await logActivity({
    actorType: "admin",
    actorId: admin.id,
    actorDisplayName: actorLabel(admin),
    action: "admin.profile_updated",
    resourceType: "admin",
    resourceId: id,
    details: { fields: Object.keys(parsed.data) },
    ipAddress: request.headers.get("x-forwarded-for") || undefined,
    userAgent: request.headers.get("user-agent") || undefined,
  });

  return NextResponse.json({ success: true, data });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireSuperAdmin(supabase);
  if (authError) return authError;

  const { id } = await params;

  // Wave 22F-C SECURITY GUARD: cannot hard-delete self.
  // (Soft-deactivation via /api/settings:toggle_admin_active is
  // also self-blocked from Wave 22D-3 — this is consistent.)
  if (id === admin.id) {
    return NextResponse.json(
      {
        success: false,
        error: "Cannot delete your own account — ask another super_admin",
      },
      { status: 400 },
    );
  }

  // Wave 22F-C SECURITY GUARD: prevent zero-super-admin lockout.
  // If the target IS a super_admin, ensure at least one other
  // super_admin remains AFTER the delete.
  const { data: target } = await supabaseAdmin
    .from("admins")
    .select("role, email")
    .eq("id", id)
    .maybeSingle();

  if (!target) {
    return NextResponse.json(
      { success: false, error: "Admin not found" },
      { status: 404 },
    );
  }

  if (target.role === "super_admin") {
    const { count } = await supabaseAdmin
      .from("admins")
      .select("id", { count: "exact", head: true })
      .eq("role", "super_admin")
      .eq("is_active", true);
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Cannot delete the last active super_admin — promote another admin first",
        },
        { status: 400 },
      );
    }
  }

  // Look up auth.users id by email so we can also delete the auth
  // record. admins.id is NOT the same as auth.users.id; admins
  // joins on email.
  const { data: usersList } = await supabaseAdmin.auth.admin.listUsers();
  const authUser = usersList?.users.find((u) => u.email === target.email);

  // Delete admins row first (DB cascade hits admin_backup_codes; sets
  // admin_login_logs.admin_id = NULL). Auth deletion is best-effort
  // — if it fails, the orphan auth row can sign in but won't reach
  // any admin endpoint (getAdmin returns null, requireAuth 401s).
  const { error: dbError } = await supabaseAdmin
    .from("admins")
    .delete()
    .eq("id", id);
  if (dbError) {
    return NextResponse.json(
      { success: false, error: dbError.message },
      { status: 500 },
    );
  }

  if (authUser) {
    await supabaseAdmin.auth.admin.deleteUser(authUser.id).catch((e) => {
      console.error("auth.admin.deleteUser failed:", e);
    });
  }

  await logActivity({
    actorType: "admin",
    actorId: admin.id,
    actorDisplayName: actorLabel(admin),
    action: "admin.deleted",
    resourceType: "admin",
    resourceId: id,
    details: { target_email: target.email, target_role: target.role },
    ipAddress: request.headers.get("x-forwarded-for") || undefined,
    userAgent: request.headers.get("user-agent") || undefined,
  });

  return NextResponse.json({
    success: true,
    message: `Admin ${target.email} permanently deleted`,
  });
}
