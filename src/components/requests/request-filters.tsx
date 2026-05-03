"use client";

/**
 * Wave 26-D-post1 (gap Section 5 from BRAINSTORM_PROXIES_2026-05-03.md).
 *
 * User feedback (verbatim 2026-05-03):
 *   "Sao mục lắm sub-tab vậy bro, mọi sub-tab đều cùng 1 loại là Yêu
 *   cầu proxy hoặc Bảo hành mà, thì về cơ bản chỉ có 2 sub-tab là Yêu
 *   cầu và Bảo hành, trong từng sub-tab thì có cột riêng là đã duyệt,
 *   từ chối,… chứ sao lại chia lắm tab vậy khó quản hơn không."
 *
 *   "lọc filter của 2 sub-tab cần thật sự mạnh"
 *
 * Pre-fix: /requests page had 2 hardcoded tabs ("Chờ xử lý" / "Gần đây
 * 7 ngày") + 1 search input. Admin couldn't filter by date range, by
 * approval mode (auto vs manual), or combine multiple statuses. Status
 * options were buried in the tab choice.
 *
 * Now: single table + filter row with 5 dropdowns + search.
 *
 *   ┌── Trạng thái ──┐ ┌── Khoảng TG ──┐ ┌── Loại proxy ──┐ ┌── Cách duyệt ──┐
 *   │ Đang đợi (12)  │ │ 7 ngày        │ │ HTTP / HTTPS / │ │ Auto / Manual  │
 *   │ Đã duyệt (45)  │ │ 30 ngày       │ │ SOCKS5         │ │                │
 *   │ Tự động duyệt  │ │ Tự chọn       │ │                │ │                │
 *   │ Bị từ chối     │ │ Hôm nay       │ │                │ │                │
 *   │ Hết hạn        │ │ Tất cả        │ │                │ │                │
 *   └────────────────┘ └───────────────┘ └────────────────┘ └────────────────┘
 *   ┌── Quốc gia ──┐ ┌── Search ──────────────────────────┐ ┌── Reset ──┐
 *   │ Mọi quốc gia │ │ [user / proxy host:port]           │ │   X       │
 *   └──────────────┘ └────────────────────────────────────┘ └───────────┘
 *
 * Each dropdown supports an "Tất cả" entry that clears the filter.
 * Filter state is encoded into the URL query string so admins can
 * bookmark + share filtered views (e.g.
 * `/requests?status=pending&within=24h&proxyType=http`).
 *
 * Default open state: `Trạng thái = Đang đợi + Khoảng TG = 7 ngày`
 * — admins land on the queue that needs action.
 */

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, X, Filter as FilterIcon } from "lucide-react";

// ─── Filter state shape ────────────────────────────────────────────
export interface RequestPageFilters {
  /** Multi-status select: "all" or comma-separated status enum. */
  status: string;
  /** Time-range bucket: today / 7d / 30d / custom / all. */
  within: TimeBucket;
  /** ISO YYYY-MM-DD when within === "custom". */
  dateFrom?: string;
  dateTo?: string;
  /** Proxy protocol filter. "all" = no filter. */
  proxyType: string;
  /** Approval mode filter. "all" = no filter. */
  approvalMode: string;
  /** Country code filter. Empty = no filter. */
  country: string;
  /** Free-text search (server uses search_text tsvector). */
  search: string;
}

export type TimeBucket = "today" | "7d" | "30d" | "custom" | "all";

// Defaults — admin lands on the queue that needs action.
export const DEFAULT_REQUEST_FILTERS: RequestPageFilters = {
  status: "pending",
  within: "7d",
  proxyType: "all",
  approvalMode: "all",
  country: "",
  search: "",
};

// ─── Label maps (Vietnamese) ──────────────────────────────────────
// Pinned in this module so labels never drift away from server enum
// values. The Select widget renders these via SelectValue's `labels`
// prop so both the trigger (when collapsed) AND the menu items show
// the same text.

export const STATUS_OPTIONS = [
  { value: "all", label: "Tất cả trạng thái" },
  { value: "pending", label: "Đang đợi" },
  { value: "approved", label: "Đã duyệt (admin)" },
  { value: "auto_approved", label: "Tự động duyệt" },
  { value: "rejected", label: "Bị từ chối" },
  { value: "expired", label: "Hết hạn chờ" },
  { value: "cancelled", label: "Đã huỷ" },
] as const;

export const WITHIN_OPTIONS: ReadonlyArray<{ value: TimeBucket; label: string }> = [
  { value: "today", label: "Hôm nay" },
  { value: "7d", label: "7 ngày qua" },
  { value: "30d", label: "30 ngày qua" },
  { value: "custom", label: "Tự chọn ngày" },
  { value: "all", label: "Tất cả thời gian" },
];

export const PROXY_TYPE_OPTIONS = [
  { value: "all", label: "Mọi giao thức" },
  { value: "http", label: "HTTP" },
  { value: "https", label: "HTTPS" },
  { value: "socks5", label: "SOCKS5" },
] as const;

export const APPROVAL_MODE_OPTIONS = [
  { value: "all", label: "Mọi cách duyệt" },
  { value: "auto", label: "Tự động" },
  { value: "manual", label: "Thủ công" },
] as const;

interface RequestFiltersProps {
  filters: RequestPageFilters;
  onFiltersChange: (next: RequestPageFilters) => void;
  /** Per-status counts for the badge inside dropdown items. */
  counts?: Partial<Record<string, number>>;
  /** Country list from /api/proxies/stats — same shape as the proxy filter. */
  countries: string[];
  /** Number of currently active filters, computed by parent. */
  activeCount: number;
}

/**
 * Wave 26-D-post1 — compute how many filters are active vs the default.
 * Used by the parent to show "Bộ lọc (3)" + an "Xoá lọc" button.
 */
export function countActiveFilters(filters: RequestPageFilters): number {
  let n = 0;
  if (filters.status !== DEFAULT_REQUEST_FILTERS.status) n++;
  if (filters.within !== DEFAULT_REQUEST_FILTERS.within) n++;
  if (filters.proxyType !== DEFAULT_REQUEST_FILTERS.proxyType) n++;
  if (filters.approvalMode !== DEFAULT_REQUEST_FILTERS.approvalMode) n++;
  if (filters.country) n++;
  if (filters.search) n++;
  if (filters.within === "custom" && (filters.dateFrom || filters.dateTo)) n++;
  return n;
}

export function RequestFilters({
  filters,
  onFiltersChange,
  counts,
  countries,
  activeCount,
}: RequestFiltersProps) {
  // Local search state debounced into the parent — pre-fix every
  // keystroke fired a fetch which spammed the API.
  const [searchInput, setSearchInput] = useState(filters.search);
  useEffect(() => {
    setSearchInput(filters.search);
  }, [filters.search]);

  function update<K extends keyof RequestPageFilters>(
    key: K,
    value: RequestPageFilters[K],
  ) {
    onFiltersChange({ ...filters, [key]: value });
  }

  function applySearch() {
    if (searchInput !== filters.search) {
      onFiltersChange({ ...filters, search: searchInput });
    }
  }

  function clearAll() {
    setSearchInput("");
    onFiltersChange({ ...DEFAULT_REQUEST_FILTERS });
  }

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <section
      className="space-y-2 rounded-lg border bg-card p-3 sm:p-4"
      aria-label="Bộ lọc yêu cầu proxy"
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FilterIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          <span>Bộ lọc</span>
          {activeCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {activeCount} đang lọc
            </Badge>
          )}
        </div>
        {activeCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="h-7 px-2 text-xs"
          >
            <X className="mr-1 size-3" aria-hidden="true" />
            Xoá lọc
          </Button>
        )}
      </header>

      {/* Filter row — wraps responsively. */}
      <div className="flex flex-wrap gap-2">
        {/* Trạng thái */}
        <Select
          value={filters.status}
          onValueChange={(v) => update("status", v ?? "all")}
        >
          <SelectTrigger className="w-[170px]" aria-label="Lọc theo trạng thái">
            <SelectValue
              labels={Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]))}
            />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <span className="flex w-full items-center justify-between gap-3">
                  <span>{opt.label}</span>
                  {counts && counts[opt.value] != null && (
                    <Badge
                      variant="outline"
                      className="h-4 min-w-[1.5rem] px-1 text-[10px] font-semibold tabular-nums"
                    >
                      {counts[opt.value]}
                    </Badge>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Khoảng thời gian */}
        <Select
          value={filters.within}
          onValueChange={(v) =>
            update("within", (v as TimeBucket | null) ?? "all")
          }
        >
          <SelectTrigger className="w-[160px]" aria-label="Lọc theo khoảng thời gian">
            <SelectValue
              labels={Object.fromEntries(WITHIN_OPTIONS.map((o) => [o.value, o.label]))}
            />
          </SelectTrigger>
          <SelectContent>
            {WITHIN_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Custom date range — only when within=custom */}
        {filters.within === "custom" && (
          <div className="flex items-center gap-1">
            <Input
              type="date"
              value={filters.dateFrom ?? ""}
              onChange={(e) =>
                update("dateFrom", e.target.value || undefined)
              }
              className="h-9 w-[150px]"
              aria-label="Từ ngày"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <Input
              type="date"
              value={filters.dateTo ?? ""}
              onChange={(e) =>
                update("dateTo", e.target.value || undefined)
              }
              className="h-9 w-[150px]"
              aria-label="Đến ngày"
            />
          </div>
        )}

        {/* Loại proxy */}
        <Select
          value={filters.proxyType}
          onValueChange={(v) => update("proxyType", v ?? "all")}
        >
          <SelectTrigger className="w-[150px]" aria-label="Lọc theo loại proxy">
            <SelectValue
              labels={Object.fromEntries(PROXY_TYPE_OPTIONS.map((o) => [o.value, o.label]))}
            />
          </SelectTrigger>
          <SelectContent>
            {PROXY_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Cách duyệt */}
        <Select
          value={filters.approvalMode}
          onValueChange={(v) => update("approvalMode", v ?? "all")}
        >
          <SelectTrigger className="w-[150px]" aria-label="Lọc theo cách duyệt">
            <SelectValue
              labels={Object.fromEntries(APPROVAL_MODE_OPTIONS.map((o) => [o.value, o.label]))}
            />
          </SelectTrigger>
          <SelectContent>
            {APPROVAL_MODE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Quốc gia */}
        {countries.length > 0 && (
          <Select
            value={filters.country || "_all"}
            onValueChange={(v) => update("country", v === "_all" || v == null ? "" : v)}
          >
            <SelectTrigger className="w-[140px]" aria-label="Lọc theo quốc gia">
              <SelectValue
                labels={{
                  _all: "Mọi quốc gia",
                  ...Object.fromEntries(countries.map((c) => [c, c])),
                }}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Mọi quốc gia</SelectItem>
              {countries.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Search free-text */}
        <div className="relative flex min-w-[220px] flex-1 items-center">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applySearch();
              if (e.key === "Escape") setSearchInput("");
            }}
            onBlur={applySearch}
            placeholder="Tìm theo user, proxy host:port hoặc lý do..."
            className="h-9 pl-9 pr-9"
            aria-label="Tìm kiếm"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                onFiltersChange({ ...filters, search: "" });
              }}
              aria-label="Xoá tìm kiếm"
              className="absolute right-2 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
