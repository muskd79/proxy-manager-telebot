"use client";

/**
 * Wave 22U — sub-tabs nested under "Quản lý Bot".
 *
 * Phase 1 sub-tabs:
 *   - /bot              — Tổng quan (landing with cards)
 *   - /bot/simulator    — Giả lập (test bot commands; moved from /bot-simulator)
 *   - /bot/config       — Cấu hình (Phase 2 stub: webhook, command list, ban list)
 *
 * Wave 22V (planned): add Thống kê + Lệnh & Phản hồi tabs per UX
 * agent's recommendation.
 */

import { LayoutGrid, Terminal, Cog } from "lucide-react";
import { PageSubTabs, type PageSubTabItem } from "@/components/navigation/page-sub-tabs";

const tabs: readonly PageSubTabItem[] = [
  { href: "/bot", labelKey: "botTabs.overview", icon: LayoutGrid, match: "exact" },
  { href: "/bot/simulator", labelKey: "botTabs.simulator", icon: Terminal },
  { href: "/bot/config", labelKey: "botTabs.config", icon: Cog },
];

export function BotSubTabs() {
  return <PageSubTabs tabs={tabs} ariaLabel="Quản lý Bot" />;
}
