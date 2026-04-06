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
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // Realtime sync: dashboard updates on data changes (debounced to reduce load)
  const dashDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const supabase = createClient();
    const debouncedFetch = () => {
      clearTimeout(dashDebounceRef.current);
      dashDebounceRef.current = setTimeout(() => {
        fetchStats();
      }, 2000);
    };
    const channel = supabase
      .channel("dashboard-changes")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "proxies" }, debouncedFetch)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "proxy_requests" }, debouncedFetch)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "tele_users" }, debouncedFetch)
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
