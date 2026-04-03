import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkProxy } from "@/lib/proxy-checker";
import { HEALTH_CHECK_CONCURRENCY } from "@/lib/constants";

const BATCH_SIZE = 500;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("CRON_SECRET not configured");
    return NextResponse.json({ success: false, error: "Server misconfigured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

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

    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const { id, alive: isAlive, speed_ms } = r.value;

      await supabaseAdmin
        .from("proxies")
        .update({
          speed_ms: isAlive ? speed_ms : null,
          last_checked_at: new Date().toISOString(),
          ...(isAlive ? {} : { status: "maintenance" }),
        })
        .eq("id", id);

      if (isAlive) alive++;
      else dead++;
    }
  }

  return NextResponse.json({
    success: true,
    data: { checked: proxies.length, alive, dead },
  });
}
