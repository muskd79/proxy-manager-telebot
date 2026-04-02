"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Globe,
  Users,
  Clock,
  CheckCircle,
  TrendingUp,
  TrendingDown,
  Server,
} from "lucide-react";
import type { DashboardStats } from "@/types/api";

interface StatsCardsProps {
  stats: DashboardStats | null;
  loading?: boolean;
}

interface StatCardProps {
  title: string;
  value: number;
  subtitle: string;
  icon: React.ReactNode;
  trend?: { value: number; positive: boolean };
}

function StatCard({ title, value, subtitle, icon, trend }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value.toLocaleString()}</div>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-xs text-muted-foreground">{subtitle}</p>
          {trend && (
            <span
              className={`flex items-center gap-0.5 text-xs font-medium ${
                trend.positive ? "text-emerald-500" : "text-red-500"
              }`}
            >
              {trend.positive ? (
                <TrendingUp className="size-3" />
              ) : (
                <TrendingDown className="size-3" />
              )}
              {trend.value}%
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function StatsCards({ stats, loading }: StatsCardsProps) {
  if (loading || !stats) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-16 animate-pulse rounded bg-muted" />
              <div className="h-3 w-32 mt-2 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title="Total Proxies"
        value={stats.totalProxies}
        subtitle={`${stats.availableProxies} available / ${stats.assignedProxies} assigned / ${stats.expiredProxies} expired`}
        icon={<Server className="size-4" />}
      />
      <StatCard
        title="Telegram Users"
        value={stats.totalUsers}
        subtitle={`${stats.activeUsers} active / ${stats.blockedUsers} blocked / ${stats.pendingUsers} pending`}
        icon={<Users className="size-4" />}
      />
      <StatCard
        title="Pending Requests"
        value={stats.pendingRequests}
        subtitle={`${stats.totalRequests} total requests`}
        icon={<Clock className="size-4" />}
      />
      <StatCard
        title="Assigned Today"
        value={stats.todayApproved}
        subtitle={`${stats.todayRequests} requests today`}
        icon={<CheckCircle className="size-4" />}
      />
    </div>
  );
}
