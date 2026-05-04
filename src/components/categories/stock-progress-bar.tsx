"use client";

/**
 * Wave 27 PR-2 — stacked 3-color progress bar for the stock breakdown.
 *
 * Segments:
 *   green  = available
 *   amber  = assigned
 *   red    = broken (reported_broken + expired + banned + maintenance)
 *
 * When `total` = 0 we render a thin placeholder bar with overlay text
 * so empty categories still have visual weight (preserves card height).
 */

import { cn } from "@/lib/utils";
import { CARD_COLORS } from "@/lib/categories/colors";
import { deriveProgressBarSegments } from "@/lib/categories/aggregations";
import type { CategoryDashboardRow } from "@/lib/categories/types";
import { formatCount } from "@/lib/categories/formatters";

interface StockProgressBarProps {
  row: Pick<
    CategoryDashboardRow,
    | "cnt_available"
    | "cnt_assigned"
    | "cnt_reported_broken"
    | "cnt_expired"
    | "cnt_banned"
    | "cnt_maintenance"
    | "proxy_count"
  >;
}

export function StockProgressBar({ row }: StockProgressBarProps) {
  const segs = deriveProgressBarSegments(row);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-400">Tồn kho</span>
        <span className="font-semibold text-slate-200">
          {formatCount(row.proxy_count)}
        </span>
      </div>

      {segs === null ? (
        <div
          className={cn(
            "relative flex h-2 items-center justify-center overflow-hidden rounded-full",
            CARD_COLORS.progressTrack,
          )}
        >
          <span className="absolute inset-0 flex items-center justify-center text-[10px] text-slate-500">
            Chưa có proxy
          </span>
        </div>
      ) : (
        <div
          className={cn(
            "flex h-2 overflow-hidden rounded-full",
            CARD_COLORS.progressTrack,
          )}
          role="progressbar"
          aria-valuenow={row.proxy_count}
          aria-valuemin={0}
          aria-valuemax={row.proxy_count}
          aria-label={`Phân bố tồn kho: ${segs.available.count} sẵn sàng, ${segs.assigned.count} đã giao, ${segs.broken.count} báo lỗi`}
        >
          <div
            className={cn("h-full motion-safe:transition-all motion-safe:duration-300", CARD_COLORS.progressAvailable)}
            style={{ width: `${segs.available.widthPct}%` }}
          />
          <div
            className={cn("h-full motion-safe:transition-all motion-safe:duration-300", CARD_COLORS.progressAssigned)}
            style={{ width: `${segs.assigned.widthPct}%` }}
          />
          <div
            className={cn("h-full motion-safe:transition-all motion-safe:duration-300", CARD_COLORS.progressBroken)}
            style={{ width: `${segs.broken.widthPct}%` }}
          />
        </div>
      )}
    </div>
  );
}
