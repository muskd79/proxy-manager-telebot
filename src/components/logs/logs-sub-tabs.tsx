"use client";

/**
 * Wave 22V — sub-tabs nested under "Lịch sử & Nhật ký".
 *
 * Mirrors ProxySubTabs pattern: 2 routes, shared header.
 *   /history  — Lịch sử (request history — what bot users did)
 *   /logs     — Nhật ký (audit trail — what admins did)
 *
 * Sidebar entry stays under "/logs" with altPaths=["/history"]
 * so both URLs light up the same parent menu item.
 */

import { History, ScrollText } from "lucide-react";
import { PageSubTabs, type PageSubTabItem } from "@/components/navigation/page-sub-tabs";

const tabs: readonly PageSubTabItem[] = [
  { href: "/history", labelKey: "logsTabs.history", icon: History },
  { href: "/logs", labelKey: "logsTabs.audit", icon: ScrollText, match: "exact" },
];

export function LogsSubTabs() {
  return <PageSubTabs tabs={tabs} ariaLabel="Lịch sử & Nhật ký" />;
}
