"use client";

import { useState, useEffect, useRef } from "react";
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
import { Search, X } from "lucide-react";
import { ProxyType, ProxyStatus } from "@/types/database";
import type { ProxyFilters as ProxyFiltersType } from "@/types/api";
import {
  NETWORK_TYPE_VALUES,
  NETWORK_TYPE_LABEL,
  type NetworkType,
} from "@/lib/proxy-labels";

/**
 * Wave 22C → 22J: filter bar fully Vietnamese.
 *
 * Adds two new filters introduced in Wave 22J:
 *   - "Phân loại" (network_type)
 *   - "Hạn dùng" (derived from expires_at — server resolves to a
 *     date predicate)
 *
 * Categories are the strong grouping; the per-category filter chip
 * is rendered separately on /proxies?category_id=X — kept out of
 * this component to keep the bar simple.
 */

interface CategoryOption {
  id: string;
  name: string;
}

// Wave 22AA — label maps drive both <SelectItem> children AND
// <SelectValue labels={...}> trigger render. Single source of
// truth so the displayed text never goes out of sync with the
// raw value (Base UI's SelectValue defaults to showing the raw
// value attribute, not the SelectItem text).
const TYPE_LABELS = {
  all: "Mọi giao thức",
  http: "HTTP",
  https: "HTTPS",
  socks5: "SOCKS5",
} as const;

const STATUS_LABELS_FILTER = {
  all: "Mọi trạng thái",
  available: "Sẵn sàng",
  assigned: "Đã giao",
  banned: "Báo lỗi",
  // Wave 22AB — Sắp hết hạn promoted from the standalone Hạn dùng
  // filter into the main status filter. Server treats it as a
  // synthetic status (where now < expires_at <= now+3d).
  expiring_soon: "Sắp hết hạn",
  hidden: "Đã ẩn",
} as const;

interface ProxyFiltersProps {
  filters: ProxyFiltersType;
  onFiltersChange: (filters: ProxyFiltersType) => void;
  countries: string[];
  /**
   * Wave 22Z — categories list for the new Danh mục filter dropdown.
   * Source: /api/categories. The parent page fetches once and passes
   * the trimmed list down so this component stays presentational.
   */
  categories?: readonly CategoryOption[];
}

export function ProxyFilters({
  filters,
  onFiltersChange,
  countries,
  categories = [],
}: ProxyFiltersProps) {
  function updateFilter(key: keyof ProxyFiltersType, value: unknown) {
    onFiltersChange({ ...filters, [key]: value || undefined, page: 1 });
  }

  function clearFilters() {
    onFiltersChange({
      page: 1,
      pageSize: filters.pageSize,
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
    });
    setSearchInput("");
  }

  // Wave 26-B (gap 3.3) — debounce the search input. Pre-fix every
  // keystroke fired updateFilter → fetchProxies; typing a 10-char
  // search burnt 10 API calls. Now: local input state for instant UI,
  // 300ms debounced commit to filters.search.
  const [searchInput, setSearchInput] = useState(filters.search || "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    // Sync local input when external filters reset (e.g. clearFilters
    // from elsewhere, or URL navigation).
    setSearchInput(filters.search || "");
  }, [filters.search]);
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const trimmed = searchInput.trim();
      if (trimmed === (filters.search ?? "")) return;
      onFiltersChange({ ...filters, search: trimmed || undefined, page: 1 });
    }, 300);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // Wave 26-B (gap 3.2) — count active filters for the visible badge.
  // Pre-fix: filtering changed results but the bar visually identical
  // to default; admins lost track of how many filters they had set.
  const activeFilters = [
    filters.search,
    filters.type,
    filters.networkType,
    filters.status,
    filters.country,
    filters.categoryId,
  ].filter((v) => v !== undefined && v !== null && v !== "").length;
  const hasActiveFilters = activeFilters > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          {/* Wave 26-B (gap 3.3) — local searchInput; debounced commit
              to filters.search 300ms after last keystroke. */}
          <Input
            placeholder="Tìm theo host..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* Giao thức (HTTP/HTTPS/SOCKS5) */}
        <Select
          value={filters.type || "all"}
          onValueChange={(val: string | null) =>
            updateFilter("type", !val || val === "all" ? undefined : val)
          }
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Giao thức" labels={TYPE_LABELS} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{TYPE_LABELS.all}</SelectItem>
            <SelectItem value={ProxyType.HTTP}>{TYPE_LABELS.http}</SelectItem>
            <SelectItem value={ProxyType.HTTPS}>{TYPE_LABELS.https}</SelectItem>
            <SelectItem value={ProxyType.SOCKS5}>{TYPE_LABELS.socks5}</SelectItem>
          </SelectContent>
        </Select>

        {/* Wave 22J — Phân loại proxy (network_type) */}
        <Select
          value={filters.networkType || "all"}
          onValueChange={(val: string | null) =>
            updateFilter("networkType", !val || val === "all" ? undefined : val)
          }
        >
          <SelectTrigger className="w-[180px]">
            {/* Wave 22AB — renamed "Phân loại" → "Loại mạng" so it
                doesn't sound like "Danh mục" (category). User
                feedback: "phân loại với danh mục là cùng 1 à". They
                are NOT — network_type is a fixed taxonomy of network
                medium (ISP/Datacenter/Mobile/...), categories are
                user-managed groupings on /categories. */}
            <SelectValue
              placeholder="Loại mạng"
              labels={{
                all: "Mọi loại mạng",
                ...Object.fromEntries(
                  NETWORK_TYPE_VALUES.map((nt) => [nt, NETWORK_TYPE_LABEL[nt as NetworkType]]),
                ),
              }}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Mọi loại mạng</SelectItem>
            {NETWORK_TYPE_VALUES.map((nt) => (
              <SelectItem key={nt} value={nt}>
                {NETWORK_TYPE_LABEL[nt as NetworkType]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Wave 22Z — Trạng thái simplified to 4 buckets per user spec:
              Sẵn sàng (available)
              Đã giao  (assigned)
              Báo lỗi  (banned)
              Đã ẩn    (synthetic — proxies.hidden=true, which the
                        cascade trigger keeps in sync with category.is_hidden)
            "Maintenance" + "Expired" enum values still exist in DB but
            are intentionally not exposed here per user "chỉ có 4 loại". */}
        <Select
          value={filters.status || "all"}
          onValueChange={(val: string | null) =>
            updateFilter("status", !val || val === "all" ? undefined : val)
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Trạng thái" labels={STATUS_LABELS_FILTER} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{STATUS_LABELS_FILTER.all}</SelectItem>
            <SelectItem value={ProxyStatus.Available}>{STATUS_LABELS_FILTER.available}</SelectItem>
            <SelectItem value={ProxyStatus.Assigned}>{STATUS_LABELS_FILTER.assigned}</SelectItem>
            <SelectItem value={ProxyStatus.Banned}>{STATUS_LABELS_FILTER.banned}</SelectItem>
            <SelectItem value="expiring_soon">{STATUS_LABELS_FILTER.expiring_soon}</SelectItem>
            <SelectItem value="hidden">{STATUS_LABELS_FILTER.hidden}</SelectItem>
          </SelectContent>
        </Select>

        {/* Wave 22AB — standalone Hạn dùng dropdown removed.
            "Sắp hết hạn" folded into the main Trạng thái filter
            per user spec (only one status concept). */}

        <Select
          value={filters.country || "all"}
          onValueChange={(val: string | null) =>
            updateFilter("country", !val || val === "all" ? undefined : val)
          }
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue
              placeholder="Quốc gia"
              labels={{
                all: "Mọi quốc gia",
                ...Object.fromEntries(countries.map((c) => [c, c])),
              }}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Mọi quốc gia</SelectItem>
            {countries.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Wave 22Z — Danh mục filter (uses ?category_id= server-side
            via mig 028 + Wave 22A index idx_proxies_category_id) */}
        {categories.length > 0 && (
          <Select
            value={filters.categoryId || "all"}
            onValueChange={(val: string | null) =>
              updateFilter("categoryId", !val || val === "all" ? undefined : val)
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue
                placeholder="Danh mục"
                labels={{
                  all: "Mọi danh mục",
                  ...Object.fromEntries(categories.map((c) => [c.id, c.name])),
                }}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Mọi danh mục</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Wave 22Y — ISP filter input removed (column dropped from UI) */}

        {hasActiveFilters && (
          <>
            {/* Wave 26-B (gap 3.2) — active-filter count badge */}
            <Badge variant="secondary" className="gap-1 whitespace-nowrap">
              {activeFilters} filter đang dùng
            </Badge>
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="size-4 mr-1" />
              Xoá tất cả
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
