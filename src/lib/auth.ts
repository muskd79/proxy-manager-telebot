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

// ============================================================
// Wave 22D — numeric role hierarchy
//
// Pre-Wave-22D, role checks were string-array allowlists:
//   if (!["super_admin","admin"].includes(admin.role)) deny()
//
// Two problems with that pattern:
//   1. Adding a new role between admin and super_admin (e.g. operator=70)
//      requires touching every allowlist.
//   2. Boolean helpers like canWrite/canManageAdmins duplicate the role
//      knowledge across 3+ functions, drifting over time.
//
// Replacement: a single ROLE_LEVELS map. All checks reduce to
//   `meetsMinRole(role, MIN.ADMIN)`.
//
// Levels are spaced 10/50/100 to leave room for future tiers without
// renumbering. The level table is policy (deployment-time), not data:
// it lives in code, NOT a DB column.
//
// Migration is zero-churn: the legacy `requireRole(supabase, [roles])`
// API stays as a thin wrapper that delegates to `requireMinRole` after
// computing min(level) of the allowlist.
// ============================================================

export const ROLE_LEVELS: Readonly<Record<Role, number>> = {
  viewer: 10,
  admin: 50,
  super_admin: 100,
} as const;

export const MIN = {
  VIEWER: 10,
  ADMIN: 50,
  SUPER_ADMIN: 100,
} as const;

export function roleLevel(r: Role): number {
  return ROLE_LEVELS[r];
}

export function meetsMinRole(r: Role, min: number): boolean {
  return ROLE_LEVELS[r] >= min;
}

export async function getAdmin(
  supabase: SupabaseClient,
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
  supabase: SupabaseClient,
): Promise<
  { admin: AdminInfo; error: null } | { admin: null; error: NextResponse }
> {
  const admin = await getAdmin(supabase);
  if (!admin) {
    return {
      admin: null,
      error: NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      ),
    };
  }
  return { admin, error: null };
}

/**
 * Wave 22D canonical role gate. Use this for new routes.
 *
 * Returns the admin record on success, or a NextResponse 401/403 on
 * failure. Always check the `error` field first.
 */
export async function requireMinRole(
  supabase: SupabaseClient,
  minLevel: number,
): Promise<
  { admin: AdminInfo; error: null } | { admin: null; error: NextResponse }
> {
  const admin = await getAdmin(supabase);
  if (!admin) {
    return {
      admin: null,
      error: NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      ),
    };
  }
  if (!meetsMinRole(admin.role, minLevel)) {
    return {
      admin: null,
      error: NextResponse.json(
        { success: false, error: "Forbidden: insufficient permissions" },
        { status: 403 },
      ),
    };
  }
  return { admin, error: null };
}

/**
 * Legacy allowlist-based gate. Kept for backward compat — Wave 22D
 * delegates to `requireMinRole` after computing min(level). Existing
 * 30 callers continue to work; new code should use `requireMinRole`.
 *
 * @deprecated Use `requireMinRole(supabase, MIN.ADMIN)` instead.
 */
export async function requireRole(
  supabase: SupabaseClient,
  allowedRoles: Role[],
): Promise<
  { admin: AdminInfo; error: null } | { admin: null; error: NextResponse }
> {
  if (allowedRoles.length === 0) {
    return {
      admin: null,
      error: NextResponse.json(
        { success: false, error: "Forbidden: no role allowed" },
        { status: 403 },
      ),
    };
  }
  // The minimum level among allowed roles is the effective bar.
  // e.g. ["admin","super_admin"] -> min level 50; ["viewer"] -> 10.
  const minLevel = Math.min(...allowedRoles.map(roleLevel));
  return requireMinRole(supabase, minLevel);
}

export async function requireAdminOrAbove(supabase: SupabaseClient) {
  return requireMinRole(supabase, MIN.ADMIN);
}

export async function requireSuperAdmin(supabase: SupabaseClient) {
  return requireMinRole(supabase, MIN.SUPER_ADMIN);
}

export async function requireAnyRole(supabase: SupabaseClient) {
  return requireMinRole(supabase, MIN.VIEWER);
}

// ============================================================
// Capability helpers — thin wrappers over meetsMinRole.
// Kept as separate exports so the call sites read more naturally
// (`canWrite(role)` vs `meetsMinRole(role, MIN.ADMIN)`).
// ============================================================

export function canWrite(role: Role): boolean {
  return meetsMinRole(role, MIN.ADMIN);
}

export function canManageAdmins(role: Role): boolean {
  return meetsMinRole(role, MIN.SUPER_ADMIN);
}

export function canManageSettings(role: Role): boolean {
  return meetsMinRole(role, MIN.SUPER_ADMIN);
}

/**
 * Verify cron secret using timing-safe comparison to prevent timing attacks.
 * Returns null if valid, or a NextResponse error if invalid.
 */
export function verifyCronSecret(request: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("CRON_SECRET not configured");
    return NextResponse.json(
      { success: false, error: "Server misconfigured" },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  const expected = `Bearer ${cronSecret}`;

  // Timing-safe comparison to prevent timing attacks
  try {
    const a = Buffer.from(authHeader);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
  } catch {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  return null; // Valid
}
