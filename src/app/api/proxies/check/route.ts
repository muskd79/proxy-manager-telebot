import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { Proxy } from "@/types/database";
import { requireAdminOrAbove } from "@/lib/auth";
import { checkProxy } from "@/lib/proxy-checker";
import { HEALTH_CHECK_CONCURRENCY } from "@/lib/constants";
import { CheckProxiesSchema } from "@/lib/validations";
import { assertSameOrigin } from "@/lib/csrf";

export async function POST(request: NextRequest) {
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

  const supabase = await createClient();
  const { admin, error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  try {
    const body = await request.json();
    const parsed = CheckProxiesSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { ids } = parsed.data;

    // Fetch proxy details
    const { data: rawProxies, error } = await supabase
      .from("proxies")
      .select("id, host, port, type, username, password")
      .in("id", ids);

    if (error) throw error;

    const proxies = (rawProxies ?? []) as Pick<
      Proxy,
      "id" | "host" | "port" | "type" | "username" | "password"
    >[];

    // Process in parallel batches
    const results: { id: string; alive: boolean; speed_ms: number }[] = [];

    for (let i = 0; i < proxies.length; i += HEALTH_CHECK_CONCURRENCY) {
      const batch = proxies.slice(i, i + HEALTH_CHECK_CONCURRENCY);

      const batchResults = await Promise.allSettled(
        batch.map(async (proxy) => {
          try {
            const { alive, speed_ms } = await checkProxy(proxy.host, proxy.port, proxy.type);
            return { id: proxy.id, alive, speed_ms };
          } catch {
            return { id: proxy.id, alive: false, speed_ms: 0 };
          }
        })
      );

      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          results.push(result.value);
        }
      }
    }

    // Batch update results
    const nowISO = new Date().toISOString();
    const deadIds = results.filter(r => !r.alive).map(r => r.id);

    // Dead proxies: single batch update (same values)
    if (deadIds.length > 0) {
      await supabase
        .from("proxies")
        .update({ speed_ms: null, last_checked_at: nowISO, status: "maintenance" })
        .in("id", deadIds);
    }

    // Alive proxies: concurrent updates (each has unique speed_ms)
    const aliveUpdates = results
      .filter(r => r.alive)
      .map(r => supabase.from("proxies").update({ speed_ms: r.speed_ms, last_checked_at: nowISO }).eq("id", r.id));

    if (aliveUpdates.length > 0) {
      await Promise.all(aliveUpdates);
    }

    return NextResponse.json({ success: true, data: results });
  } catch (error) {
    console.error("Health check error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to run health check" },
      { status: 500 }
    );
  }
}
