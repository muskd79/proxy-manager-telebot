import { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export type Role = "super_admin" | "admin" | "viewer";

export interface AdminInfo {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  is_active: boolean;
}

export async function getAdmin(
  supabase: SupabaseClient
): Promise<AdminInfo | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const { data } = await supabase
    .from("admins")
    .select("id, email, full_name, role, is_active")
    .eq("email", user.email)
    .eq("is_active", true)
    .single();

  if (!data) return null;
  return data as AdminInfo;
}

export async function requireAuth(
  supabase: SupabaseClient
): Promise<{ admin: AdminInfo; error: null } | { admin: null; error: NextResponse }> {
  const admin = await getAdmin(supabase);
  if (!admin) {
    return {
      admin: null,
      error: NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }
  return { admin, error: null };
}

export async function requireRole(
  supabase: SupabaseClient,
  allowedRoles: Role[]
): Promise<{ admin: AdminInfo; error: null } | { admin: null; error: NextResponse }> {
  const admin = await getAdmin(supabase);
  if (!admin) {
    return {
      admin: null,
      error: NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }
  if (!allowedRoles.includes(admin.role)) {
    return {
      admin: null,
      error: NextResponse.json(
        { success: false, error: "Forbidden: insufficient permissions" },
        { status: 403 }
      ),
    };
  }
  return { admin, error: null };
}

export async function requireAdminOrAbove(supabase: SupabaseClient) {
  return requireRole(supabase, ["super_admin", "admin"]);
}

export async function requireSuperAdmin(supabase: SupabaseClient) {
  return requireRole(supabase, ["super_admin"]);
}

export async function requireAnyRole(supabase: SupabaseClient) {
  return requireRole(supabase, ["super_admin", "admin", "viewer"]);
}

export function canWrite(role: Role): boolean {
  return role === "super_admin" || role === "admin";
}

export function canManageAdmins(role: Role): boolean {
  return role === "super_admin";
}

export function canManageSettings(role: Role): boolean {
  return role === "super_admin";
}

/**
 * Verify cron secret using timing-safe comparison to prevent timing attacks.
 * Returns null if valid, or a NextResponse error if invalid.
 */
export function verifyCronSecret(request: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("CRON_SECRET not configured");
    return NextResponse.json({ success: false, error: "Server misconfigured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const expected = `Bearer ${cronSecret}`;

  // Timing-safe comparison to prevent timing attacks
  try {
    const a = Buffer.from(authHeader);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  return null; // Valid
}
