import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireAnyRole } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  try {
    // Get requests from last 14 days
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const { data: requests } = await supabase
      .from("proxy_requests")
      .select("status, processed_at, created_at")
      .gte("created_at", fourteenDaysAgo.toISOString())
      .eq("is_deleted", false);

    // Get chat messages for active user count
    const { data: messages } = await supabase
      .from("chat_messages")
      .select("tele_user_id, created_at")
      .gte("created_at", fourteenDaysAgo.toISOString());

    // Build daily stats
    const dailyMap = new Map<string, { approved: number; rejected: number; auto_approved: number; active_users: Set<string> }>();

    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split("T")[0];
      dailyMap.set(key, { approved: 0, rejected: 0, auto_approved: 0, active_users: new Set() });
    }

    for (const req of requests || []) {
      const date = (req.processed_at || req.created_at).split("T")[0];
      const entry = dailyMap.get(date);
      if (!entry) continue;
      if (req.status === "approved") entry.approved++;
      else if (req.status === "auto_approved") entry.auto_approved++;
      else if (req.status === "rejected") entry.rejected++;
    }

    for (const msg of messages || []) {
      const date = msg.created_at.split("T")[0];
      const entry = dailyMap.get(date);
      if (entry) entry.active_users.add(msg.tele_user_id);
    }

    const data = Array.from(dailyMap.entries()).map(([date, stats]) => ({
      date: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      approved: stats.approved,
      rejected: stats.rejected,
      auto_approved: stats.auto_approved,
      active_users: stats.active_users.size,
    }));

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("Analytics error:", err);
    return NextResponse.json({ success: false, error: "Failed to fetch analytics" }, { status: 500 });
  }
}
