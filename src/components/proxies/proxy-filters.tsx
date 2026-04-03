"use client";

import { useState, useRef, useCallback } from "react";
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
import { Search, X, Tag } from "lucide-react";
import { ProxyType, ProxyStatus } from "@/types/database";
import type { ProxyFilters as ProxyFiltersType } from "@/types/api";

const POPULAR_TAGS = ["residential", "datacenter", "premium", "fast", "rotating", "static", "mobile"];

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
  const [tagInput, setTagInput] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);

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
    setTagInput("");
  }

  const addTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim().toLowerCase();
      if (!trimmed) return;
      const currentTags = filters.tags || [];
      if (currentTags.includes(trimmed)) return;
      updateFilter("tags", [...currentTags, trimmed]);
      setTagInput("");
    },
    [filters.tags]
  );

  function removeTag(tag: string) {
    const currentTags = filters.tags || [];
    const newTags = currentTags.filter((t) => t !== tag);
    updateFilter("tags", newTags.length > 0 ? newTags : undefined);
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagInput);
    }
    if (e.key === "Backspace" && !tagInput && filters.tags?.length) {
      removeTag(filters.tags[filters.tags.length - 1]);
    }
  }

  const hasActiveFilters =
    filters.search ||
    filters.type ||
    filters.status ||
    filters.country ||
    filters.isp ||
    (filters.tags && filters.tags.length > 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
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

        {/* ISP filter */}
        <Input
          placeholder="ISP..."
          value={filters.isp || ""}
          onChange={(e) => updateFilter("isp", e.target.value)}
          className="w-32"
        />

        {/* Tags filter input */}
        <div className="relative min-w-[200px] max-w-sm">
          <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            ref={tagInputRef}
            placeholder="Filter by tags..."
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            onBlur={() => { if (tagInput.trim()) addTag(tagInput); }}
            className="pl-8"
          />
        </div>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="size-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Selected tags and popular tag chips */}
      {(filters.tags?.length || !filters.tags?.length) && (
        <div className="flex flex-wrap items-center gap-2">
          {/* Active tag filters */}
          {filters.tags?.map((tag) => (
            <Badge key={tag} variant="default" className="gap-1 text-xs">
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="ml-0.5 rounded-full hover:bg-foreground/20 p-0.5"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}

          {/* Popular tags as quick-filter chips */}
          {POPULAR_TAGS.filter((t) => !filters.tags?.includes(t)).length > 0 && (
            <>
              {filters.tags && filters.tags.length > 0 && (
                <span className="text-xs text-muted-foreground mx-1">|</span>
              )}
              <span className="text-xs text-muted-foreground">Quick:</span>
              {POPULAR_TAGS.filter((t) => !filters.tags?.includes(t)).map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="cursor-pointer text-xs hover:bg-accent transition-colors"
                  onClick={() => addTag(tag)}
                >
                  {tag}
                </Badge>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
