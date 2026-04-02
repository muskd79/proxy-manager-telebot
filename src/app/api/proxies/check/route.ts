import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { Proxy } from "@/types/database";
import { requireAdminOrAbove } from "@/lib/auth";
import { checkProxy } from "@/lib/proxy-checker";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { ids } = body as { ids: string[] };

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { success: false, error: "ids array is required" },
        { status: 400 }
      );
    }

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

    // Process in parallel batches of 50
    const CONCURRENCY = 50;
    const results: { id: string; alive: boolean; speed_ms: number }[] = [];

    for (let i = 0; i < proxies.length; i += CONCURRENCY) {
      const batch = proxies.slice(i, i + CONCURRENCY);

      const batchResults = await Promise.allSettled(
        batch.map(async (proxy: any) => {
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
    for (const r of results) {
      await supabase
        .from("proxies")
        .update({
          speed_ms: r.alive ? r.speed_ms : null,
          last_checked_at: new Date().toISOString(),
          status: r.alive ? undefined : "maintenance",
        })
        .eq("id", r.id);
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
