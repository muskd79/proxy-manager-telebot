"use client";

/**
 * Wave 22U — /bot landing page (Quản lý Bot tổng quan).
 *
 * Phase 1: Two cards — Giả lập (Simulator) + Cấu hình (Config).
 * Architect's call: real page > server redirect to /bot/simulator,
 * because the sidebar's "Bot" link feels like a lie if it
 * teleports somewhere else, and breadcrumbs + browser history
 * stay clean.
 *
 * Phase 2 (Wave 22V planned): replace cards with a real bot dashboard:
 *   - Webhook health (last delivery, retry count)
 *   - Active users last 24h
 *   - Top commands, error rate
 *   - Bot token expiry & rate-limit headroom
 */

import Link from "next/link";
import { Bot, Terminal, Cog, ArrowRight, Activity, MessageSquare } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BotSubTabs } from "@/components/bot/bot-sub-tabs";

export default function BotOverviewPage() {
  return (
    <div className="flex-1 space-y-6 p-6">
      <BotSubTabs />

      <div className="mt-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Quản lý Bot</h1>
            <p className="text-sm text-muted-foreground">
              Kiểm soát Telegram bot — giả lập, cấu hình, thống kê.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <BotCard
          href="/bot/simulator"
          icon={Terminal}
          title="Giả lập (Simulator)"
          description="Test các lệnh bot mà không cần Telegram thật. Xem phản hồi, inline keyboard, conversation flow trực tiếp trong dashboard."
          cta="Mở Simulator"
        />
        <BotCard
          href="/settings"
          icon={Cog}
          title="Cấu hình"
          description="Webhook URL, bot token, command list, rate-limit. Hiện đang ở trang Cài đặt chung."
          cta="Mở Cài đặt"
        />
        <SoonCard
          icon={Activity}
          title="Thống kê"
          description="Lượng tin nhắn / giờ, lỗi, top lệnh, người dùng hoạt động. (Wave 22V)"
        />
        <SoonCard
          icon={MessageSquare}
          title="Lệnh & Phản hồi"
          description="Quản lý template phản hồi tự động, lệnh tuỳ chỉnh. (Wave 22V)"
        />
      </div>
    </div>
  );
}

interface BotCardProps {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  cta: string;
  comingSoon?: boolean;
}

function BotCard({ href, icon: Icon, title, description, cta, comingSoon }: BotCardProps) {
  return (
    <Link href={href} className="group">
      <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/30">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">{title}</CardTitle>
            {comingSoon && (
              <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-300">
                Sắp ra mắt
              </span>
            )}
          </div>
          <CardDescription className="leading-relaxed">{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <span className="inline-flex items-center gap-1 text-sm font-medium text-primary group-hover:underline">
            {cta} <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

function SoonCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <Card className="h-full opacity-70">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base text-muted-foreground">{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
