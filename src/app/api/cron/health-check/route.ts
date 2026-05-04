import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkProxy } from "@/lib/proxy-checker";
import { HEALTH_CHECK_CONCURRENCY, HEALTH_CHECK_CRON_BATCH_SIZE } from "@/lib/constants";
import { verifyCronSecret } from "@/lib/auth";
import { withCronLock } from "@/lib/cron/advisory-lock";

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const outcome = await withCronLock(supabaseAdmin, "cron.health_check", async () => {
    return runHealthCheck();
  });

  if (outcome.skipped) {
    return NextResponse.json({ success: true, data: { skipped: true, reason: outcome.reason } });
  }
  return NextResponse.json({ success: true, data: outcome.result });
}

async function runHealthCheck() {
  // Wave 26-D bug hunt v3 [CRITICAL] — only health-check proxies in
  // states where flipping to maintenance is the correct response to a
  // failed TCP probe. Pre-fix the cron pulled EVERY non-deleted row and
  // forced status='maintenance' on TCP failure, which:
  //   - Stole `assigned` proxies from active users mid-rental (proxy
  //     went from "Đã giao" to "Bảo trì" silently — user kept using it
  //     but admin dashboard showed maintenance).
  //   - Stole `reported_broken` proxies from the warranty workflow.
  //     The warranty approve handler does
  //     `.update(...).eq('status','reported_broken')` — once the cron
  //     flipped status to maintenance the UPDATE matched 0 rows, so
  //     the original proxy was never transitioned and the replacement
  //     was given out with the original stuck in maintenance forever.
  //   - Auto-reverted intentional `banned`/`expired` admin decisions
  //     back into the maintenance pool.
  //
  // Now: only check `available` (idle inventory we want to keep healthy)
  // and `maintenance` (already parked, idempotent re-check). Active
  // states (`assigned`, `reported_broken`) are off-limits because the
  // workflow owns the status transition. Terminal states (`banned`,
  // `expired`) are off-limits because they're admin/cron decisions we
  // shouldn't bulldoze.
  const { data: proxies, error } = await supabaseAdmin
    .from("proxies")
    .select("id, host, port, type")
    .eq("is_deleted", false)
    .in("status", ["available", "maintenance"])
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(HEALTH_CHECK_CRON_BATCH_SIZE);

  if (error || !proxies || proxies.length === 0) {
    return { checked: 0, alive: 0, dead: 0 };
  }

  let alive = 0;
  let dead = 0;

  // Process in parallel batches
  for (let i = 0; i < proxies.length; i += HEALTH_CHECK_CONCURRENCY) {
    const batch = proxies.slice(i, i + HEALTH_CHECK_CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (proxy) => {
        try {
          const result = await checkProxy(proxy.host, proxy.port, proxy.type);
          return { id: proxy.id, ...result };
        } catch {
          return { id: proxy.id, alive: false, speed_ms: 0 };
        }
      })
    );

    const nowISO = new Date().toISOString();
    const aliveIds: string[] = [];
    const aliveSpeedUpdates: PromiseLike<unknown>[] = [];
    const deadIds: string[] = [];

    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const { id, alive: isAlive, speed_ms } = r.value;

      if (isAlive) {
        alive++;
        aliveIds.push(id);
        // Each alive proxy has unique speed_ms, update concurrently
        aliveSpeedUpdates.push(
          supabaseAdmin.from("proxies").update({ speed_ms, last_checked_at: nowISO }).eq("id", id)
        );
      } else {
        dead++;
        deadIds.push(id);
      }
    }

    // Batch update dead proxies in one query (all share same values).
    //
    // Wave 26-D bug hunt v3 [CRITICAL] — defence-in-depth race guard.
    // Even after narrowing the SELECT to ["available","maintenance"],
    // the row could have transitioned (admin clicked Sửa, user
    // submitted warranty, allocator assigned) between SELECT and
    // UPDATE. The `.in("status", ["available", "maintenance"])` on the
    // UPDATE ensures we never overwrite a row that's now in
    // assigned/reported_broken/banned/expired. The row count won't
    // surface the skip but `last_checked_at` not updating is the
    // signal — and the next cron run picks it up if it's truly dead.
    if (deadIds.length > 0) {
      await supabaseAdmin
        .from("proxies")
        .update({ speed_ms: null, last_checked_at: nowISO, status: "maintenance" })
        .in("id", deadIds)
        .in("status", ["available", "maintenance"]);
    }

    // Update alive proxies concurrently (not sequentially)
    if (aliveSpeedUpdates.length > 0) {
      await Promise.all(aliveSpeedUpdates);
    }
  }

  return { checked: proxies.length, alive, dead };
}
