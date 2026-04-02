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
    filters.search || filters.type || filters.status || filters.country;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search by host..."
          value={filters.search || ""}
          onChange={(e) => updateFilter("search", e.target.value)}
          className="pl-8"
        />
      </div>

      <Select
        value={filters.type || "all"}
        onValueChange={(val: string | null) =>
          updateFilter("type", !val || val === "all" ? undefined : val)
        }
      >
        <SelectTrigger className="w-[130px]">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value={ProxyType.HTTP}>HTTP</SelectItem>
          <SelectItem value={ProxyType.HTTPS}>HTTPS</SelectItem>
          <SelectItem value={ProxyType.SOCKS5}>SOCKS5</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={filters.status || "all"}
        onValueChange={(val: string | null) =>
          updateFilter("status", !val || val === "all" ? undefined : val)
        }
      >
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value={ProxyStatus.Available}>Available</SelectItem>
          <SelectItem value={ProxyStatus.Assigned}>Assigned</SelectItem>
          <SelectItem value={ProxyStatus.Expired}>Expired</SelectItem>
          <SelectItem value={ProxyStatus.Banned}>Banned</SelectItem>
          <SelectItem value={ProxyStatus.Maintenance}>Maintenance</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={filters.country || "all"}
        onValueChange={(val: string | null) =>
          updateFilter("country", !val || val === "all" ? undefined : val)
        }
      >
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Country" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Countries</SelectItem>
          {countries.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          <X className="size-4 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}
