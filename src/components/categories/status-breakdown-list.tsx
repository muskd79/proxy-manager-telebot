"use client";

/**
 * Wave 27 PR-2 — status breakdown list for the card body.
 *
 * Renders one row per status with a colored dot + count + label.
 * Hides zero-count rows by default (set `showZero` to render all
 * 6 statuses for diagnostic purposes).
 *
 * Live/Die sub-rows from VIA Manager design were intentionally
 * dropped — proxy status enum is the breakdown axis here.
 */

import { cn } from "@/lib/utils";
import { CARD_COLORS } from "@/lib/categories/colors";
import { buildStatusBreakdown, type StatusBreakdownItem } from "@/lib/categories/aggregations";
import type { CategoryDashboardRow } from "@/lib/categories/types";

interface StatusBreakdownListProps {
  row: Pick<
    CategoryDashboardRow,
    | "cnt_available"
    | "cnt_assigned"
    | "cnt_reported_broken"
    | "cnt_expired"
    | "cnt_banned"
    | "cnt_maintenance"
  >;
  showZero?: boolean;
}

const TONE_DOT: Record<StatusBreakdownItem["tone"], string> = {
  available: CARD_COLORS.dotAvailable,
  assigned: CARD_COLORS.dotAssigned,
  broken: CARD_COLORS.dotBroken,
  muted: CARD_COLORS.dotMuted,
};

export function StatusBreakdownList({ row, showZero = false }: StatusBreakdownListProps) {
  const items = buildStatusBreakdown(row, { hideZero: !showZero });

  if (items.length === 0) {
    return (
      <p className="text-xs text-slate-500">Chưa có proxy nào trong danh mục</p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5 text-xs">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-2">
          <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[item.tone])} />
          <span className="text-slate-300 tabular-nums">{item.count}</span>
          <span className="text-slate-500">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
