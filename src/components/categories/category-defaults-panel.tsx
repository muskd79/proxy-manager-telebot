"use client";

/**
 * Wave 27 PR-3 — defaults panel on /categories/[id].
 *
 * Shows what fields will be auto-filled when a new proxy is added
 * to this category. Read-only view — admin edits via the form
 * dialog. Each row shows the field label + current default value
 * (or "—" placeholder if not set).
 *
 * Pairs with the SQL trigger fn_proxy_snapshot_category_defaults
 * (mig 059) — the source of truth for what fills on insert.
 */

import { Globe, Tag, Server, Building2, DollarSign, Coins, Network } from "lucide-react";
import { cn } from "@/lib/utils";
import { networkTypeLabel } from "@/lib/proxy-labels";
import { formatVnd } from "@/lib/categories/formatters";
import type { CategoryRow } from "@/lib/categories/types";

interface CategoryDefaultsPanelProps {
  category: CategoryRow;
}

interface DefaultRow {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
  /** Optional helper line below the value. */
  hint?: string;
}

export function CategoryDefaultsPanel({ category }: CategoryDefaultsPanelProps) {
  const rows: DefaultRow[] = [
    {
      icon: Globe,
      label: "Quốc gia",
      value: category.default_country || null,
    },
    {
      icon: Tag,
      label: "Loại proxy",
      value: category.default_proxy_type
        ? category.default_proxy_type.toUpperCase()
        : null,
    },
    {
      icon: Network,
      label: "Phân loại",
      value: category.default_network_type
        ? networkTypeLabel(category.default_network_type)
        : null,
    },
    {
      icon: Building2,
      label: "ISP",
      value: category.default_isp || null,
    },
    {
      icon: Server,
      label: "Nhà cung cấp",
      value: category.default_vendor_source || null,
    },
    {
      icon: DollarSign,
      label: "Giá vốn (USD)",
      value:
        category.default_purchase_price_usd != null
          ? `$${category.default_purchase_price_usd.toFixed(2)}`
          : null,
    },
    {
      icon: Coins,
      label: "Giá bán mặc định",
      value:
        category.default_sale_price_usd != null
          ? formatVnd(category.default_sale_price_usd)
          : null,
    },
  ];

  return (
    <section
      className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-4 space-y-3"
      aria-label="Giá trị mặc định"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">
          Giá trị mặc định
        </h2>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          Tự điền khi thêm proxy
        </span>
      </div>

      <p className="text-xs text-slate-500">
        Khi thêm proxy mới vào danh mục này, các trường sau sẽ tự được điền
        nếu admin để trống. Trigger DB chạy trên mọi đường thêm proxy (web /
        bot / CSV import / script).
      </p>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.map((row) => {
          const Icon = row.icon;
          const hasValue = row.value !== null;
          return (
            <li
              key={row.label}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border border-slate-800/40 bg-slate-950/40 p-2.5",
              )}
            >
              <Icon
                className={cn(
                  "size-4 shrink-0",
                  hasValue ? "text-slate-300" : "text-slate-600",
                )}
                aria-hidden="true"
              />
              <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                <span className="text-[11px] uppercase tracking-wide text-slate-500">
                  {row.label}
                </span>
                <span
                  className={cn(
                    "text-sm font-medium tabular-nums truncate",
                    hasValue ? "text-slate-100" : "text-slate-600",
                  )}
                >
                  {hasValue ? row.value : "—"}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {category.min_stock_alert > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-300">
          Cảnh báo khi tồn kho sẵn sàng dưới{" "}
          <span className="font-semibold">{category.min_stock_alert}</span> proxy.
        </div>
      )}
    </section>
  );
}
