import { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

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

export async function requireAuth(supabase: SupabaseClient) {
  const admin = await getAdmin(supabase);
  if (!admin) {
    return {
      admin: null as never,
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
) {
  const admin = await getAdmin(supabase);
  if (!admin) {
    return {
      admin: null as never,
      error: NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }
  if (!allowedRoles.includes(admin.role)) {
    return {
      admin: null as never,
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
