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
  STATUS_LABEL,
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

interface ProxyFiltersProps {
  filters: ProxyFiltersType;
  onFiltersChange: (filters: ProxyFiltersType) => void;
  countries: string[];
}

export function ProxyFilters({
  filters,
  onFiltersChange,
  countries,
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
            <SelectValue placeholder="Giao thức" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Mọi giao thức</SelectItem>
            <SelectItem value={ProxyType.HTTP}>HTTP</SelectItem>
            <SelectItem value={ProxyType.HTTPS}>HTTPS</SelectItem>
            <SelectItem value={ProxyType.SOCKS5}>SOCKS5</SelectItem>
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
            <SelectValue placeholder="Phân loại" />
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

        {/* Trạng thái sử dụng */}
        <Select
          value={filters.status || "all"}
          onValueChange={(val: string | null) =>
            updateFilter("status", !val || val === "all" ? undefined : val)
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Trạng thái" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Mọi trạng thái</SelectItem>
            <SelectItem value={ProxyStatus.Available}>{STATUS_LABEL.available}</SelectItem>
            <SelectItem value={ProxyStatus.Assigned}>{STATUS_LABEL.assigned}</SelectItem>
            <SelectItem value={ProxyStatus.Banned}>{STATUS_LABEL.banned}</SelectItem>
            <SelectItem value={ProxyStatus.Maintenance}>{STATUS_LABEL.maintenance}</SelectItem>
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
            <SelectValue placeholder="Hạn dùng" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Mọi hạn dùng</SelectItem>
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
            <SelectValue placeholder="Quốc gia" />
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
