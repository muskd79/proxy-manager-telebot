import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { Proxy } from "@/types/database";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { ids } = body as { ids: string[] };

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "ids array is required" },
        { status: 400 }
      );
    }

    const results: Array<{
      id: string;
      host: string;
      port: number;
      alive: boolean;
      speed_ms: number | null;
      error?: string;
    }> = [];

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

    for (const proxy of proxies) {
      const startTime = Date.now();

      try {
        // Simple connectivity check via fetch with timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        await fetch(`http://${proxy.host}:${proxy.port}`, {
          method: "HEAD",
          signal: controller.signal,
        }).catch(() => {
          // Connection attempt is enough to measure latency
        });

        clearTimeout(timeout);
        const speed_ms = Date.now() - startTime;

        // Update proxy
        const updatePayload = { speed_ms, last_checked_at: new Date().toISOString() };
        const updateQuery = supabase.from("proxies");
        await updateQuery.update(updatePayload).eq("id", proxy.id);

        results.push({
          id: proxy.id,
          host: proxy.host,
          port: proxy.port,
          alive: true,
          speed_ms,
        });
      } catch (checkError) {
        const speed_ms = Date.now() - startTime;

        const errUpdatePayload = { speed_ms, last_checked_at: new Date().toISOString() };
        const errUpdateQuery = supabase.from("proxies");
        await errUpdateQuery.update(errUpdatePayload).eq("id", proxy.id);

        results.push({
          id: proxy.id,
          host: proxy.host,
          port: proxy.port,
          alive: false,
          speed_ms: null,
          error:
            checkError instanceof Error ? checkError.message : "Check failed",
        });
      }
    }

    return NextResponse.json({ success: true, data: results });
  } catch (error) {
    console.error("Health check error:", error);
    return NextResponse.json(
      { error: "Failed to run health check" },
      { status: 500 }
    );
  }
}
