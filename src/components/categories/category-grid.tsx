"use client";

/**
 * Wave 27 PR-2 — top-level category grid.
 *
 * Owns: data fetch (delegated to caller via `rows` prop, page-level
 * useEffect), selection state, layout. Doesn't own filter state — that
 * lives at page level so search/sort/filter UI can be shared with
 * other dashboard pages later.
 *
 * Layout: 3 columns at xl, 2 at md, 1 below. Brainstormer #9: when
 * count ≤ 2, center the cards rather than leaving orphan slots in
 * the 3-col grid.
 */

import { cn } from "@/lib/utils";
import type { CategoryDashboardRow } from "@/lib/categories/types";
import { CategoryCard } from "./category-card";
import { CategoryCardSkeleton } from "./category-card-skeleton";
import { CategoryGridEmpty } from "./category-grid-empty";

interface CategoryGridProps {
  rows: CategoryDashboardRow[];
  isLoading: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  hideMoney?: boolean;
  /** Called when admin clicks "Xoá hết bộ lọc" in the filter-empty state. */
  onClearFilters?: () => void;
  /** Called when admin clicks "+ Tạo danh mục đầu tiên" in zero-data state. */
  onCreateCategory?: () => void;
  /** Whether at least one filter is active. Used to switch empty state mode. */
  hasActiveFilter?: boolean;
}

export function CategoryGrid({
  rows,
  isLoading,
  selectedIds,
  onToggleSelect,
  hideMoney = false,
  onClearFilters,
  onCreateCategory,
  hasActiveFilter = false,
}: CategoryGridProps) {
  if (isLoading) {
    return (
      <div
        className={cn(
          "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3",
        )}
        aria-busy="true"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <CategoryCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <CategoryGridEmpty
          mode={hasActiveFilter ? "filter-empty" : "zero-data"}
          onClearFilters={onClearFilters}
          onCreateCategory={onCreateCategory}
        />
      </div>
    );
  }

  // Layout decision: ≤2 categories center the cards; ≥3 use full grid.
  const containerClasses =
    rows.length === 1
      ? "mx-auto grid max-w-md grid-cols-1 gap-4"
      : rows.length === 2
        ? "mx-auto grid max-w-3xl grid-cols-1 gap-4 md:grid-cols-2"
        : "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3";

  return (
    <div className={containerClasses}>
      {rows.map((row) => (
        <CategoryCard
          key={row.id}
          row={row}
          isSelected={selectedIds.has(row.id)}
          onToggleSelect={onToggleSelect}
          hideMoney={hideMoney}
        />
      ))}
    </div>
  );
}
