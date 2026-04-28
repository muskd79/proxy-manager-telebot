import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Wave 22L — Phase 1 CRITICAL fix.
 *
 * Pre-22L bug: 5 routes called `supabaseAdmin.auth.admin.listUsers()`
 * without pagination params. Supabase defaults to perPage=50 — when
 * the project grows past 50 auth users, finding an admin by email on
 * page 2+ silently returns undefined → route returns 500
 * "Admin row exists but no auth.users entry — manual cleanup needed".
 *
 * This was a time-bomb passed by every existing test because the
 * mocks return small arrays. In production it would only manifest
 * when the auth.users table crossed the 50-user threshold.
 *
 * Fix: paginate via `page` + `perPage: 1000` (Supabase max). Stop
 * as soon as the matching email is found OR the result page is empty.
 *
 * Bound: 100 pages × 1000 = 100k users. If your deployment exceeds
 * that, you need to redesign — but the bot tele_users table is
 * separate, so auth.users only contains admin accounts. This bound
 * holds far beyond practical limits.
 *
 * Affected routes (all using `find(u.email === ...)`):
 *   - /api/admins/[id]/route.ts (DELETE)
 *   - /api/admins/[id]/reset-password/route.ts
 *   - /api/admins/[id]/disable-2fa/route.ts
 *   - /api/admins/[id]/revoke-sessions/route.ts
 *   - /api/settings/route.ts (toggle_admin_active)
 */

/**
 * Find an auth.users row by email, paginating server-side.
 * Returns the user record or null if not found within the safety bound.
 */
export async function findAuthUserByEmail(
  email: string,
): Promise<{ id: string; email?: string } | null> {
  const PER_PAGE = 1000;
  const MAX_PAGES = 100; // safety cap (100k users)
  const target = email.toLowerCase();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: PER_PAGE,
    });
    if (error) {
      console.error("findAuthUserByEmail listUsers error:", error.message);
      return null;
    }
    const users = data?.users ?? [];
    if (users.length === 0) return null;

    const found = users.find((u) => u.email?.toLowerCase() === target);
    if (found) return found;

    // If this page returned fewer than perPage, we've reached the end.
    if (users.length < PER_PAGE) return null;
  }

  // Hit the safety cap without finding — log a warning so ops knows.
  console.warn(
    `findAuthUserByEmail: hit MAX_PAGES (${MAX_PAGES}) without finding ${email}. Auth user count exceeds ${MAX_PAGES * PER_PAGE} — review.`,
  );
  return null;
}
