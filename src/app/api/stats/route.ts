import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireAnyRole } from "@/lib/auth";

/**
 * Dashboard stats endpoint.
 *
 * Wave 22E-3 BUG FIX (B3, severity MEDIUM):
 *
 * Pre-fix code had a module-level `statsCache` plus a 30s TTL check.
 * Two issues:
 *
 *   1. Thundering herd — when the cache expired, every concurrent request
 *      independently called `get_dashboard_stats` (a 14-COUNT scan, ~140ms
 *      at 10k proxies). N concurrent visitors at the moment of expiry =
 *      N expensive RPCs racing to overwrite `statsCache`.
 *
 *   2. False confidence — `let statsCache` is module-scoped per JS process.
 *      Vercel cold-start spins up new processes; each has its own empty
 *      cache. The cache helps only when the SAME warm instance serves
 *      consecutive requests. With even 2 instances the hit rate is poor.
 *
 * Fix: drop the in-process cache entirely. The `Cache-Control:
 * s-maxage=30, stale-while-revalidate=60` HTTP header instructs Vercel's
 * edge cache to serve a single fetched value to ALL concurrent requests
 * for 30s, then serve the stale value for up to 60s while one
 * background request refreshes it. This is exactly what the Vercel edge
 * does well, and it's coherent across all instances/regions.
 *
 * The dashboard rendering already handles the slight latency with a
 * loading skeleton, so removing the in-process cache is invisible to UX.
 */
export async function GET(_request: NextRequest) {
  const supabase = await createClient();
  const { error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  try {
    const { data, error } = await supabase.rpc("get_dashboard_stats");
    if (error) throw error;

    return NextResponse.json(
      { success: true, data },
      {
        headers: {
          // s-maxage tells Vercel's edge cache to serve a SINGLE fetched
          // value to all concurrent requests for 30 seconds. stale-while-
          // revalidate lets it serve a stale value for up to 60 more
          // seconds while one background request refreshes it. This is
          // a CDN-coherent thundering-herd defence — much stronger than
          // the per-instance module-level cache that lived here before.
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (error) {
    console.error(
      "Stats error:",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { success: false, error: "Failed to fetch stats" },
      { status: 500 },
    );
  }
}
