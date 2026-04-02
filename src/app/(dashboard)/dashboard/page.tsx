"use client";

import { useEffect, useState, useCallback } from "react";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { ProxyChart } from "@/components/dashboard/proxy-chart";
import { RecentRequests } from "@/components/dashboard/recent-requests";
import { ActiveUsers } from "@/components/dashboard/active-users";
import type { DashboardStats } from "@/types/api";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
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

    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of your proxy management system
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              Updated {lastUpdated.toLocaleTimeString()}
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
            Refresh
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
