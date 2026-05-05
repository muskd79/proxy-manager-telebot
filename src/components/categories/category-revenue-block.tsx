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
    | "default_purchase_price_usd"
    | "stock_value_usd"
    | "revenue_usd_cumulative"
    | "cost_usd_total"
  >;
  /** When true (viewer role) revenue + cost columns are hidden. */
  hideMoney?: boolean;
}

export function CategoryRevenueBlock({ row, hideMoney = false }: CategoryRevenueBlockProps) {
  // Wave 28-H — surface BOTH default prices + computed margin so
  // admins can compare at a glance without opening each card. The
  // whole point of Wave 28-C splitting "Giá mặc định" → "Giá mua +
  // Giá bán" was margin visibility; pre-fix this block only showed
  // sale price.
  const purchase = row.default_purchase_price_usd;
  const sale = row.default_sale_price_usd;
  const hasBothPrices =
    typeof purchase === "number" &&
    purchase > 0 &&
    typeof sale === "number" &&
    sale > 0;
  const marginPct = hasBothPrices
    ? Math.round(((sale - purchase) / purchase) * 100)
    : null;
  // Negative margin = loss-leader / clear-stock. Highlight in amber
  // so admin sees the sign of the bet before clicking through.
  const marginIsLoss = marginPct !== null && marginPct < 0;

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
          {formatVnd(sale)}
        </span>
      </div>

      {/* Wave 28-H — purchase price + margin row. Only renders when
          purchase price is set (admin who hasn't filled it sees the
          old single-price view, no clutter). */}
      {typeof purchase === "number" && purchase > 0 && (
        <div className="mt-1 flex items-baseline justify-between text-xs">
          <span className="text-slate-500">Giá mua</span>
          <span className="font-medium tabular-nums text-slate-400">
            {formatVnd(purchase)}
            {marginPct !== null && (
              <span
                className={cn(
                  "ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                  marginIsLoss
                    ? "bg-amber-500/15 text-amber-400"
                    : "bg-emerald-500/15 text-emerald-400",
                )}
                title={
                  marginIsLoss
                    ? "Giá bán < giá mua — đang lỗ / clear-stock"
                    : `Margin = (Giá bán − Giá mua) / Giá mua = ${marginPct}%`
                }
              >
                {marginIsLoss ? "" : "+"}
                {marginPct}%
              </span>
            )}
          </span>
        </div>
      )}

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
