/**
 * Wave 27 — single Supabase entry point for the categories surface.
 *
 * Every read/write of `proxy_categories` flows through here. API
 * routes, the Telegram bot, and the React UI all import this module —
 * never touch `supabase.from("proxy_categories")` directly.
 *
 * Benefits:
 *   - One place to change auth scoping if RLS policy moves.
 *   - One place to add caching / dedup / instrumentation.
 *   - Tests mock this module instead of mocking Supabase chains.
 *   - Bot + web don't drift (Wave 26-D v4 lesson).
 *
 * Naming convention: each function returns
 * `{ data, error }` mirroring Supabase JS so callers don't need a
 * second translation layer. `error` is `null` on success.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CategoryDashboardRow,
  CategoryApplyMode,
} from "./types";

interface RepoResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

/**
 * Fetch the categories dashboard (ALL categories with full
 * aggregate breakdown). Single RPC round-trip — see mig 059.
 *
 * The caller decides whether to filter hidden categories
 * client-side; the RPC always returns everything so admin can
 * toggle "Include hidden" without a refetch.
 */
export async function getCategoryDashboard(
  client: SupabaseClient,
): Promise<RepoResult<CategoryDashboardRow[]>> {
  const { data, error } = await client.rpc("get_category_dashboard");
  if (error) {
    return {
      data: null,
      error: { message: error.message, code: error.code },
    };
  }
  return {
    data: (data ?? []) as CategoryDashboardRow[],
    error: null,
  };
}

/**
 * Apply category defaults retroactively to existing proxies in the
 * category. `mode='only_null'` fills blanks; `mode='force'`
 * overwrites everything.
 *
 * The RPC writes an audit log entry — caller doesn't need to
 * double-log.
 */
export async function applyCategoryDefaultsRetroactively(
  client: SupabaseClient,
  args: { categoryId: string; mode: CategoryApplyMode },
): Promise<RepoResult<{ ok: boolean; affected: number; mode: string }>> {
  const { data, error } = await client.rpc(
    "apply_category_defaults_retroactively",
    {
      p_category_id: args.categoryId,
      p_mode: args.mode,
    },
  );
  if (error) {
    return {
      data: null,
      error: { message: error.message, code: error.code },
    };
  }
  // The RPC returns JSONB; Supabase JS deserialises it as an object.
  const result = data as
    | { ok: boolean; affected?: number; mode?: string; error?: string }
    | null;
  if (!result || result.ok !== true) {
    return {
      data: null,
      error: {
        message: result?.error ?? "Unknown apply-defaults failure",
      },
    };
  }
  return {
    data: {
      ok: true,
      affected: result.affected ?? 0,
      mode: result.mode ?? args.mode,
    },
    error: null,
  };
}
