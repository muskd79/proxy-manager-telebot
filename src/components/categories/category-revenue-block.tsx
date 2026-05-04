"use client";

/**
 * Wave 27 PR-2 — money summary at the bottom of CategoryCard.
 *
 *   GIÁ BÁN MẶC ĐỊNH    50K
 *   Doanh thu           11.4M
 *   Giá vốn             1.1M
 *
 * On mobile (`<md`) Doanh thu and Giá vốn stack vertically; on `md+`
 * they sit side-by-side. Default sale price is always its own row.
 *
 * Revenue uses the cumulative number from proxy_events (immutable).
 * Stock_value is exposed via tooltip — secondary metric.
 */

import { cn } from "@/lib/utils";
import { CARD_COLORS } from "@/lib/categories/colors";
import { formatVnd } from "@/lib/categories/formatters";
import type { CategoryDashboardRow } from "@/lib/categories/types";

interface CategoryRevenueBlockProps {
  row: Pick<
    CategoryDashboardRow,
    | "default_sale_price_usd"
    | "stock_value_usd"
    | "revenue_usd_cumulative"
    | "cost_usd_total"
  >;
  /** When true (viewer role) revenue + cost columns are hidden. */
  hideMoney?: boolean;
}

export function CategoryRevenueBlock({ row, hideMoney = false }: CategoryRevenueBlockProps) {
  return (
    <div
      className={cn(
        "mt-1 rounded-lg border p-3",
        CARD_COLORS.moneyBlockBorder,
        CARD_COLORS.moneyBlockBg,
      )}
    >
      <div className="flex items-baseline justify-between">
        <span
          className={cn(
            "text-[10px] font-medium uppercase tracking-wide",
            CARD_COLORS.moneyLabel,
          )}
        >
          Giá bán mặc định
        </span>
        <span className={cn("text-sm font-bold", CARD_COLORS.moneyValueDefault)}>
          {formatVnd(row.default_sale_price_usd)}
        </span>
      </div>

      {!hideMoney && (
        <div className="mt-2 flex flex-col gap-1 md:flex-row md:items-center md:justify-between md:gap-4">
          <div className="flex items-center justify-between md:gap-3">
            <span className="text-xs text-slate-500">Doanh thu</span>
            <span
              className={cn(
                "text-sm font-semibold tabular-nums",
                row.revenue_usd_cumulative > 0
                  ? CARD_COLORS.moneyValueRevenue
                  : "text-slate-500",
              )}
              title="Tổng doanh thu tất cả các lần giao trong danh mục này (đọc từ proxy_events)"
            >
              {row.revenue_usd_cumulative > 0
                ? formatVnd(row.revenue_usd_cumulative)
                : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between md:gap-3">
            <span className="text-xs text-slate-500">Giá vốn</span>
            <span
              className={cn(
                "text-sm font-semibold tabular-nums",
                row.cost_usd_total > 0
                  ? CARD_COLORS.moneyValueCost
                  : "text-slate-500",
              )}
              title="Tổng giá vốn (cost_usd) của các proxy chưa xoá"
            >
              {row.cost_usd_total > 0 ? formatVnd(row.cost_usd_total) : "—"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
