import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { DashboardStats } from "@/types/api";
import type { Proxy, TeleUser, ProxyRequest } from "@/types/database";
import { requireAnyRole } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  try {
    // Proxy counts by status
    const { data: rawProxies, error: proxyError } = await supabase
      .from("proxies")
      .select("status")
      .eq("is_deleted", false);

    if (proxyError) throw proxyError;

    const proxies = (rawProxies ?? []) as Pick<Proxy, "status">[];
    const totalProxies = proxies.length;
    const availableProxies = proxies.filter(
      (p) => p.status === "available"
    ).length;
    const assignedProxies = proxies.filter(
      (p) => p.status === "assigned"
    ).length;
    const expiredProxies = proxies.filter(
      (p) => p.status === "expired"
    ).length;

    // User counts by status
    const { data: rawUsers, error: userError } = await supabase
      .from("tele_users")
      .select("status")
      .eq("is_deleted", false);

    if (userError) throw userError;

    const users = (rawUsers ?? []) as Pick<TeleUser, "status">[];
    const totalUsers = users.length;
    const activeUsers = users.filter((u) => u.status === "active").length;
    const pendingUsers = users.filter((u) => u.status === "pending").length;
    const blockedUsers = users.filter((u) => u.status === "blocked").length;

    // Request counts
    const { data: rawRequests, error: reqError } = await supabase
      .from("proxy_requests")
      .select("status, created_at")
      .eq("is_deleted", false);

    if (reqError) throw reqError;

    const requests = (rawRequests ?? []) as Pick<
      ProxyRequest,
      "status" | "created_at"
    >[];
    const totalRequests = requests.length;
    const pendingRequests = requests.filter(
      (r) => r.status === "pending"
    ).length;
    const approvedRequests = requests.filter(
      (r) => r.status === "approved" || r.status === "auto_approved"
    ).length;
    const rejectedRequests = requests.filter(
      (r) => r.status === "rejected"
    ).length;

    // Today's stats
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();

    const todayRequests = requests.filter(
      (r) => r.created_at >= todayISO
    ).length;
    const todayApproved = requests.filter(
      (r) =>
        r.created_at >= todayISO &&
        (r.status === "approved" || r.status === "auto_approved")
    ).length;

    const stats: DashboardStats = {
      totalProxies,
      availableProxies,
      assignedProxies,
      expiredProxies,
      totalUsers,
      activeUsers,
      pendingUsers,
      blockedUsers,
      totalRequests,
      pendingRequests,
      approvedRequests,
      rejectedRequests,
      todayRequests,
      todayApproved,
    };

    return NextResponse.json({ success: true, data: stats });
  } catch (error) {
    console.error("Stats error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
