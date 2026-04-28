"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  EXPIRY_LABEL,
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
  hidden: "Đã ẩn",
} as const;

const EXPIRY_LABELS_FILTER = {
  all: "Mọi hạn dùng",
  valid: "Còn hạn",
  expiring_soon: "Sắp hết hạn",
  expired: "Hết hạn",
  never: "Vĩnh viễn",
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
  }

  const hasActiveFilters =
    filters.search ||
    filters.type ||
    filters.networkType ||
    filters.status ||
    filters.expiryStatus ||
    filters.country ||
    // Wave 22Y — isp filter removed (column dropped from UI)
    filters.categoryId;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Tìm theo host..."
            value={filters.search || ""}
            onChange={(e) => updateFilter("search", e.target.value)}
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
            <SelectValue
              placeholder="Phân loại"
              labels={{
                all: "Mọi phân loại",
                ...Object.fromEntries(
                  NETWORK_TYPE_VALUES.map((nt) => [nt, NETWORK_TYPE_LABEL[nt as NetworkType]]),
                ),
              }}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Mọi phân loại</SelectItem>
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
            <SelectItem value="hidden">{STATUS_LABELS_FILTER.hidden}</SelectItem>
          </SelectContent>
        </Select>

        {/* Wave 22J — Hạn dùng (derived) */}
        <Select
          value={filters.expiryStatus || "all"}
          onValueChange={(val: string | null) =>
            updateFilter("expiryStatus", !val || val === "all" ? undefined : val)
          }
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Hạn dùng" labels={EXPIRY_LABELS_FILTER} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{EXPIRY_LABELS_FILTER.all}</SelectItem>
            <SelectItem value="valid">{EXPIRY_LABEL.valid}</SelectItem>
            <SelectItem value="expiring_soon">{EXPIRY_LABEL.expiring_soon}</SelectItem>
            <SelectItem value="expired">{EXPIRY_LABEL.expired}</SelectItem>
            <SelectItem value="never">{EXPIRY_LABEL.never}</SelectItem>
          </SelectContent>
        </Select>

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
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="size-4 mr-1" />
            Xoá lọc
          </Button>
        )}
      </div>
    </div>
  );
}
