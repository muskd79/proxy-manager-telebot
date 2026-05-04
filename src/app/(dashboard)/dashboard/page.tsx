"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { ProxyChart } from "@/components/dashboard/proxy-chart";
import { RecentRequests } from "@/components/dashboard/recent-requests";
import { ActiveUsers } from "@/components/dashboard/active-users";
import type { DashboardStats } from "@/types/api";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { DASHBOARD_POLL_INTERVAL_MS } from "@/lib/constants";

// Wave 27 v10 perf [perf-optimizer #4, IMPORTANT] — dashboard
// realtime channel scoped down to high-signal table only.
// Pre-fix: subscribed to proxies + proxy_requests + tele_users on
// `event: "*"`. With 10 admins online and 100 writes/min, this
// produced 30 server-side filter evaluations per write * 100 writes
// = 3000 evaluations/min just to drive a dashboard refresh, plus
// 10 simultaneous /api/stats fetches every 2s after a bulk action.
// Now: subscribe only to proxy_requests (the most admin-actionable
// table) on UPDATE+INSERT (no DELETE — soft-delete is an UPDATE).
// 30s poll (DASHBOARD_POLL_INTERVAL_MS) remains the safety net for
// proxies + tele_users changes. The sluggishness gain on bulk
// actions is negligible since a refresh fires 30s later.

export default function DashboardPage() {
  const { t } = useI18n();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats");
      if (res.ok) {
        const result = await res.json();
        setStats(result.data);
        setLastUpdated(new Date());
      }
    } catch (err) {
      console.error("Failed to fetch dashboard stats:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();

    // Auto-refresh every 30 seconds (fallback)
    const interval = setInterval(fetchStats, DASHBOARD_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // Realtime sync — scoped to proxy_requests UPDATE+INSERT only
  // (see header comment for rationale). The 5s debounce collapses
  // bursty writes (e.g., bulk-approve 50 requests) into one
  // /api/stats fetch.
  const dashDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const supabase = createClient();
    const debouncedFetch = () => {
      clearTimeout(dashDebounceRef.current);
      dashDebounceRef.current = setTimeout(() => {
        fetchStats();
      }, 5000);
    };
    const channel = supabase
      .channel("dashboard-changes")
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "proxy_requests" },
        debouncedFetch,
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        { event: "UPDATE", schema: "public", table: "proxy_requests" },
        debouncedFetch,
      )
      .subscribe();

    return () => {
      clearTimeout(dashDebounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [fetchStats]);

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("dashboard.title")}</h1>
          <p className="text-muted-foreground">
            {t("dashboard.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              {t("dashboard.updated")} {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={fetchStats}
            disabled={loading}
          >
            <RefreshCw
              className={`size-4 mr-1.5 ${loading ? "animate-spin" : ""}`}
            />
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      <StatsCards stats={stats} loading={loading} />

      <div className="grid gap-6 lg:grid-cols-7">
        <div className="lg:col-span-4">
          <ProxyChart />
        </div>
        <div className="lg:col-span-3">
          <ActiveUsers />
        </div>
      </div>

      <RecentRequests />
    </div>
  );
}
