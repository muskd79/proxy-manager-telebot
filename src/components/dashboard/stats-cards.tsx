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
import Link from "next/link";
import type { DashboardStats } from "@/types/api";
import { routes } from "@/lib/routes";
import { useI18n } from "@/lib/i18n";

/**
 * Wave 25-pre2 (Pass 4 quick — string interpolation helper).
 * The shared i18n.t() doesn't accept variables yet (see lib/i18n.tsx);
 * keep the call site readable by handling the {placeholder} swap here.
 * Future Wave 25-pre3 will fold this into i18n.t() proper.
 */
function fillI18n(template: string, vars: Record<string, string | number>): string {
  let result = template;
  for (const [k, v] of Object.entries(vars)) {
    result = result.replaceAll(`{${k}}`, String(v));
  }
  return result;
}

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
  href?: string;
}

function StatCard({ title, value, subtitle, icon, trend, href }: StatCardProps) {
  const content = (
    <Card className={href ? "cursor-pointer hover:border-primary/30 transition-colors" : ""}>
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
            // Wave 25-pre2 (Pass 6.4) — accessibility: trend up/down was
            // signalled with green/red color only. ~8% of men (red-green
            // colorblind) lost the signal. Prefix sign so "+12%" / "-3%"
            // carries the direction without color. Icon stays for the
            // sighted majority.
            <span
              className={`flex items-center gap-0.5 text-xs font-medium ${
                trend.positive ? "text-emerald-500" : "text-red-500"
              }`}
              aria-label={`Trend: ${trend.positive ? "up" : "down"} ${Math.abs(trend.value)}%`}
            >
              {trend.positive ? (
                <TrendingUp className="size-3" aria-hidden="true" />
              ) : (
                <TrendingDown className="size-3" aria-hidden="true" />
              )}
              {trend.positive ? "+" : "-"}{Math.abs(trend.value)}%
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

export function StatsCards({ stats, loading }: StatsCardsProps) {
  // Wave 25-pre2 (Pass 7.C/7.D) — i18n + routes module integration.
  // Pre-fix titles + subtitles were hardcoded English ("Total Proxies",
  // "available / assigned / expired") inside an i18n product, and the
  // drill-down hrefs were raw query strings that would silently break
  // on a future URL refactor. Switch to:
  //   - t("dashboardCards.*") for both labels (parity-safe with vi/en)
  //   - routes.proxies({status: ...}) for typed, single-source-of-truth URLs
  const { t } = useI18n();

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
    // Phase 3 (PM UX) — KPI drill-down. Each card deep-links to the
    // FILTERED view that matches its number, so clicking "Pending
    // Requests: 12" lands on the pending tab with 12 rows visible.
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title={t("dashboardCards.totalProxies")}
        value={stats.totalProxies}
        subtitle={fillI18n(t("dashboardCards.totalProxiesSub"), {
          available: stats.availableProxies,
          assigned: stats.assignedProxies,
          expired: stats.expiredProxies,
        })}
        icon={<Server className="size-4" />}
        href={routes.proxies({ status: "available" })}
      />
      <StatCard
        title={t("dashboardCards.telegramUsers")}
        value={stats.totalUsers}
        subtitle={fillI18n(t("dashboardCards.telegramUsersSub"), {
          active: stats.activeUsers,
          blocked: stats.blockedUsers,
          pending: stats.pendingUsers,
        })}
        icon={<Users className="size-4" />}
        href={routes.users({ status: "pending" })}
      />
      <StatCard
        title={t("dashboardCards.pendingRequests")}
        value={stats.pendingRequests}
        subtitle={fillI18n(t("dashboardCards.pendingRequestsSub"), {
          total: stats.totalRequests,
        })}
        icon={<Clock className="size-4" />}
        href={routes.requests({ status: "pending" })}
      />
      <StatCard
        title={t("dashboardCards.assignedToday")}
        value={stats.todayApproved}
        subtitle={fillI18n(t("dashboardCards.assignedTodaySub"), {
          requests: stats.todayRequests,
        })}
        icon={<CheckCircle className="size-4" />}
        href={routes.history()}
      />
    </div>
  );
}
