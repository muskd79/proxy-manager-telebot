import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkProxy } from "@/lib/proxy-checker";
import { HEALTH_CHECK_CONCURRENCY } from "@/lib/constants";
import { verifyCronSecret } from "@/lib/auth";

const BATCH_SIZE = 500;

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  // Fetch 500 proxies ordered by least recently checked
  const { data: proxies, error } = await supabaseAdmin
    .from("proxies")
    .select("id, host, port, type")
    .eq("is_deleted", false)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (error || !proxies || proxies.length === 0) {
    return NextResponse.json({ success: true, data: { checked: 0, alive: 0, dead: 0 } });
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

    // Batch update dead proxies in one query (all share same values)
    if (deadIds.length > 0) {
      await supabaseAdmin
        .from("proxies")
        .update({ speed_ms: null, last_checked_at: nowISO, status: "maintenance" })
        .in("id", deadIds);
    }

    // Update alive proxies concurrently (not sequentially)
    if (aliveSpeedUpdates.length > 0) {
      await Promise.all(aliveSpeedUpdates);
    }
  }

  return NextResponse.json({
    success: true,
    data: { checked: proxies.length, alive, dead },
  });
}
