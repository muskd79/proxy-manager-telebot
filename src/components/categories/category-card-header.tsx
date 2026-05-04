"use client";

/**
 * Wave 27 PR-2 — top strip of CategoryCard.
 * Visibility chip on the left, bulk-select checkbox on the right.
 */

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { CARD_COLORS, visibilityChipTokens } from "@/lib/categories/colors";
import type { CategoryDashboardRow } from "@/lib/categories/types";

interface CategoryCardHeaderProps {
  row: Pick<CategoryDashboardRow, "is_hidden" | "name">;
  isSelected: boolean;
  onToggleSelect: () => void;
  /** When true the header strip is non-interactive (e.g. read-only viewer role). */
  readOnly?: boolean;
}

export function CategoryCardHeader({
  row,
  isSelected,
  onToggleSelect,
  readOnly = false,
}: CategoryCardHeaderProps) {
  const tokens = visibilityChipTokens(row);

  return (
    <header className="flex items-center justify-between">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
          tokens.bg,
          tokens.text,
          tokens.ring,
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", tokens.dot)} />
        {tokens.label}
      </span>

      {!readOnly && (
        <button
          type="button"
          role="checkbox"
          aria-checked={isSelected}
          aria-label={`Chọn danh mục ${row.name}`}
          data-checked={isSelected}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-md border border-slate-600 bg-slate-900 transition-all duration-150 motion-safe:transition-all",
            "hover:border-orange-500/70",
            "data-[checked=true]:border-orange-500 data-[checked=true]:bg-orange-500",
            CARD_COLORS.cardBorder,
          )}
        >
          <Check
            className={cn(
              "h-3.5 w-3.5 text-slate-950 opacity-0 transition-opacity duration-150",
              isSelected && "opacity-100",
            )}
          />
        </button>
      )}
    </header>
  );
}
