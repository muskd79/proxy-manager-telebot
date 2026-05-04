"use client";

/**
 * Wave 27 PR-2 — main category card.
 *
 * Composes header (visibility chip + checkbox), title block,
 * stock progress bar, status breakdown, and money block.
 *
 * Click model:
 *   - Card body click → navigate to /categories/[id] detail page
 *     (read mode). Decided after brainstormer #10 — making the
 *     entire card a giant "edit" button is hostile to "this card
 *     IS the view" intent.
 *   - Pencil button (in header overflow) → opens the edit dialog.
 *     PR-2 keeps the edit dialog at the page level; the pencil
 *     button is wired in PR-3 along with the bulk toolbar.
 *   - Checkbox in header → toggles selection (stopPropagation).
 */

import { Folder } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CARD_COLORS } from "@/lib/categories/colors";
import { formatCount } from "@/lib/categories/formatters";
import type { CategoryDashboardRow } from "@/lib/categories/types";
import { CategoryCardHeader } from "./category-card-header";
import { StockProgressBar } from "./stock-progress-bar";
import { StatusBreakdownList } from "./status-breakdown-list";
import { CategoryRevenueBlock } from "./category-revenue-block";

interface CategoryCardProps {
  row: CategoryDashboardRow;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  /** When true (viewer role) revenue/cost are hidden. */
  hideMoney?: boolean;
  /** When true the card is non-interactive (loading skeleton uses this indirectly). */
  readOnly?: boolean;
}

export function CategoryCard({
  row,
  isSelected,
  onToggleSelect,
  hideMoney = false,
  readOnly = false,
}: CategoryCardProps) {
  return (
    <Link
      href={`/categories/${row.id}`}
      aria-label={`Mở danh mục ${row.name} (${formatCount(row.proxy_count)} proxy${row.is_hidden ? ", đã ẩn" : ""})`}
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border p-4 motion-safe:transition-colors motion-safe:duration-150",
        CARD_COLORS.cardBorder,
        CARD_COLORS.cardBg,
        CARD_COLORS.cardBorderHover,
        CARD_COLORS.cardBgHover,
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
        isSelected && cn(CARD_COLORS.cardBorderSelected, CARD_COLORS.cardBgSelected),
      )}
      data-selected={isSelected}
    >
      <CategoryCardHeader
        row={row}
        isSelected={isSelected}
        onToggleSelect={() => onToggleSelect(row.id)}
        readOnly={readOnly}
      />

      {/* Title block */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Folder
            className="h-4 w-4 shrink-0 text-slate-400"
            aria-hidden="true"
          />
          <h3
            className="truncate text-base font-semibold text-slate-100"
            title={row.name}
          >
            {row.name}
          </h3>
          <span className="ml-auto shrink-0 rounded-md bg-slate-800/80 px-1.5 py-0.5 text-[11px] font-medium text-slate-400">
            {formatCount(row.proxy_count)} proxy
          </span>
        </div>
        <p className="line-clamp-1 text-xs text-slate-500">
          {row.description || "Không có mô tả"}
        </p>
      </div>

      <StockProgressBar row={row} />
      <StatusBreakdownList row={row} />

      {/* Footer pill — total hidden count */}
      {row.total_hidden > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
              CARD_COLORS.pillHiddenBg,
              CARD_COLORS.pillHiddenText,
            )}
          >
            <span className="h-1 w-1 rounded-full bg-slate-500" /> Đã ẩn:{" "}
            {row.total_hidden}
          </span>
        </div>
      )}

      <CategoryRevenueBlock row={row} hideMoney={hideMoney} />
    </Link>
  );
}
