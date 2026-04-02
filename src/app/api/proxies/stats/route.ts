import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { Proxy } from "@/types/database";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data: rawProxies, error } = await supabase
      .from("proxies")
      .select("type, status, country")
      .eq("is_deleted", false);

    if (error) throw error;

    const proxies = (rawProxies ?? []) as Pick<
      Proxy,
      "type" | "status" | "country"
    >[];

    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byCountry: Record<string, number> = {};

    for (const proxy of proxies) {
      byType[proxy.type] = (byType[proxy.type] || 0) + 1;
      byStatus[proxy.status] = (byStatus[proxy.status] || 0) + 1;
      if (proxy.country) {
        byCountry[proxy.country] = (byCountry[proxy.country] || 0) + 1;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        total: proxies.length,
        byType,
        byStatus,
        byCountry,
      },
    });
  } catch (error) {
    console.error("Proxy stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch proxy stats" },
      { status: 500 }
    );
  }
}
