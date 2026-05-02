"use client";

/**
 * Wave 22U — sub-tabs nested under "Quản lý Bot".
 *
 * Phase 3 (2026-05-02) — dropped /bot/config sub-tab. The page was a
 * Phase-1 stub that linked back to /settings; PM UX review flagged
 * it as bait-and-switch. Restore the tab when a real bot-config UI
 * ships (Wave 22V plan).
 *
 * Active sub-tabs:
 *   - /bot              — Tổng quan (landing with cards)
 *   - /bot/simulator    — Giả lập (test bot commands)
 */

import { LayoutGrid, Terminal } from "lucide-react";
import { PageSubTabs, type PageSubTabItem } from "@/components/navigation/page-sub-tabs";

const tabs: readonly PageSubTabItem[] = [
  { href: "/bot", labelKey: "botTabs.overview", icon: LayoutGrid, match: "exact" },
  { href: "/bot/simulator", labelKey: "botTabs.simulator", icon: Terminal },
];

export function BotSubTabs() {
  return <PageSubTabs tabs={tabs} ariaLabel="Quản lý Bot" />;
}
