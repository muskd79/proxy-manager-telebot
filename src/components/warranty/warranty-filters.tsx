"use client";

/**
 * Wave 26-D-2 — /warranty filter row.
 *
 * Mirror of src/components/requests/request-filters.tsx with the
 * warranty-specific dimensions added (lý do báo lỗi, có proxy thay
 * thế hay chưa, admin xử lý). Same look + UX so admins moving
 * between /requests và /warranty don't relearn anything.
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

// ─── Filter shape ─────────────────────────────────────────────────
export interface WarrantyPageFilters {
  status: string;            // pending / approved / rejected / all
  within: TimeBucket;        // today / 7d / 30d / custom / all
  dateFrom?: string;
  dateTo?: string;
  reasonCode: string;        // no_connect / slow / ip_blocked / wrong_country / auth_fail / other / all
  hasReplacement: string;    // yes / no / all
  resolvedBy: string;        // admin id or "all"
  search: string;
}

export type TimeBucket = "today" | "7d" | "30d" | "custom" | "all";

export const DEFAULT_WARRANTY_FILTERS: WarrantyPageFilters = {
  status: "pending",
  within: "7d",
  reasonCode: "all",
  hasReplacement: "all",
  resolvedBy: "all",
  search: "",
};

// ─── Vietnamese label maps ────────────────────────────────────────
export const WARRANTY_STATUS_OPTIONS = [
  { value: "all", label: "Tất cả trạng thái" },
  { value: "pending", label: "Đang đợi" },
  { value: "approved", label: "Đã duyệt" },
  { value: "rejected", label: "Bị từ chối" },
] as const;

export const WARRANTY_WITHIN_OPTIONS: ReadonlyArray<{
  value: TimeBucket;
  label: string;
}> = [
  { value: "today", label: "Hôm nay" },
  { value: "7d", label: "7 ngày qua" },
  { value: "30d", label: "30 ngày qua" },
  { value: "custom", label: "Tự chọn ngày" },
  { value: "all", label: "Tất cả thời gian" },
];

export const WARRANTY_REASON_OPTIONS = [
  { value: "all", label: "Mọi lý do" },
  { value: "no_connect", label: "Không kết nối được" },
  { value: "slow", label: "Chậm" },
  { value: "ip_blocked", label: "IP bị block" },
  { value: "wrong_country", label: "Sai quốc gia" },
  { value: "auth_fail", label: "Sai user/pass" },
  { value: "other", label: "Lý do khác" },
] as const;

export const HAS_REPLACEMENT_OPTIONS = [
  { value: "all", label: "Cả 2" },
  { value: "yes", label: "Đã có proxy thay thế" },
  { value: "no", label: "Chưa có thay thế" },
] as const;

interface WarrantyFiltersProps {
  filters: WarrantyPageFilters;
  onFiltersChange: (next: WarrantyPageFilters) => void;
  counts?: Partial<Record<string, number>>;
  /** Admin list for "Admin xử lý" filter — { id, label }. */
  admins: ReadonlyArray<{ id: string; label: string }>;
  activeCount: number;
}

export function countActiveWarrantyFilters(
  filters: WarrantyPageFilters,
): number {
  let n = 0;
  if (filters.status !== DEFAULT_WARRANTY_FILTERS.status) n++;
  if (filters.within !== DEFAULT_WARRANTY_FILTERS.within) n++;
  if (filters.reasonCode !== DEFAULT_WARRANTY_FILTERS.reasonCode) n++;
  if (filters.hasReplacement !== DEFAULT_WARRANTY_FILTERS.hasReplacement) n++;
  if (filters.resolvedBy !== DEFAULT_WARRANTY_FILTERS.resolvedBy) n++;
  if (filters.search) n++;
  if (filters.within === "custom" && (filters.dateFrom || filters.dateTo)) n++;
  return n;
}

export function WarrantyFilters({
  filters,
  onFiltersChange,
  counts,
  admins,
  activeCount,
}: WarrantyFiltersProps) {
  const [searchInput, setSearchInput] = useState(filters.search);
  useEffect(() => {
    setSearchInput(filters.search);
  }, [filters.search]);

  function update<K extends keyof WarrantyPageFilters>(
    key: K,
    value: WarrantyPageFilters[K],
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
    onFiltersChange({ ...DEFAULT_WARRANTY_FILTERS });
  }

  return (
    <section
      className="space-y-2 rounded-lg border bg-card p-3 sm:p-4"
      aria-label="Bộ lọc bảo hành"
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

      <div className="flex flex-wrap gap-2">
        {/* Trạng thái */}
        <Select
          value={filters.status}
          onValueChange={(v) => update("status", v ?? "all")}
        >
          <SelectTrigger className="w-[170px]" aria-label="Lọc theo trạng thái">
            <SelectValue
              labels={Object.fromEntries(
                WARRANTY_STATUS_OPTIONS.map((o) => [o.value, o.label]),
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {WARRANTY_STATUS_OPTIONS.map((opt) => (
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
              labels={Object.fromEntries(
                WARRANTY_WITHIN_OPTIONS.map((o) => [o.value, o.label]),
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {WARRANTY_WITHIN_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
              onChange={(e) => update("dateTo", e.target.value || undefined)}
              className="h-9 w-[150px]"
              aria-label="Đến ngày"
            />
          </div>
        )}

        {/* Lý do báo lỗi */}
        <Select
          value={filters.reasonCode}
          onValueChange={(v) => update("reasonCode", v ?? "all")}
        >
          <SelectTrigger className="w-[180px]" aria-label="Lọc theo lý do">
            <SelectValue
              labels={Object.fromEntries(
                WARRANTY_REASON_OPTIONS.map((o) => [o.value, o.label]),
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {WARRANTY_REASON_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Có proxy thay thế */}
        <Select
          value={filters.hasReplacement}
          onValueChange={(v) => update("hasReplacement", v ?? "all")}
        >
          <SelectTrigger className="w-[170px]" aria-label="Lọc theo proxy thay thế">
            <SelectValue
              labels={Object.fromEntries(
                HAS_REPLACEMENT_OPTIONS.map((o) => [o.value, o.label]),
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {HAS_REPLACEMENT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Admin xử lý */}
        {admins.length > 0 && (
          <Select
            value={filters.resolvedBy}
            onValueChange={(v) => update("resolvedBy", v ?? "all")}
          >
            <SelectTrigger className="w-[160px]" aria-label="Lọc theo admin xử lý">
              <SelectValue
                labels={{
                  all: "Mọi admin",
                  ...Object.fromEntries(admins.map((a) => [a.id, a.label])),
                }}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Mọi admin</SelectItem>
              {admins.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.label}
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
            placeholder="Tìm theo lý do, ghi chú từ chối..."
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
