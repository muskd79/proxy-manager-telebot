"use client";

/**
 * Wave 27 UX-3 — canonical bulk-action shell for list/grid pages.
 *
 * Extracted from `components/categories/bulk-action-toolbar.tsx`
 * (PR #22) to be reusable across /proxies, /requests, /warranty,
 * /trash sub-tabs, /users — UX audit finding #5.
 *
 * Single contract:
 *   - Sticky at `top-4`, slides in/out when selectedCount transitions
 *     across 0
 *   - Left: count label + "Bỏ chọn" link
 *   - Right: caller-supplied action buttons (passed as `actions` ReactNode)
 *
 * Why pass actions as ReactNode instead of typed button props?
 *   - Different pages have different action sets (Approve/Reject vs
 *     Hide/Show/Delete vs Block/Unblock).
 *   - A `(string, callback)[]` API would force every callsite into
 *     the same icon + label pattern; a slot lets pages compose
 *     freely while sharing the visual shell.
 *
 * Conventions for `actions` content (enforced via PR review, not
 * type system):
 *   1. Use `<Button size="sm" variant="ghost">` for non-destructive
 *      actions, `variant="destructive"` for delete-style actions.
 *   2. Put the destructive action last (rightmost).
 *   3. Always include an icon + label (no icon-only buttons —
 *      ambiguous in dark-mode).
 */

import { cn } from "@/lib/utils";

interface BulkActionBarProps {
  selectedCount: number;
  /** Vietnamese noun describing what's selected (e.g., "danh mục", "proxy"). */
  itemNoun: string;
  /** Action buttons. Caller composes — see component header for conventions. */
  actions: React.ReactNode;
  onClearSelection: () => void;
  /**
   * Optional aria-label override. Default: `Thao tác hàng loạt cho
   * {itemNoun} đã chọn` — composed from itemNoun.
   */
  ariaLabel?: string;
}

export function BulkActionBar({
  selectedCount,
  itemNoun,
  actions,
  onClearSelection,
  ariaLabel,
}: BulkActionBarProps) {
  const visible = selectedCount > 0;

  return (
    <div
      data-visible={visible}
      role="region"
      aria-label={ariaLabel ?? `Thao tác hàng loạt cho ${itemNoun} đã chọn`}
      className={cn(
        "sticky top-4 z-30 mb-4 flex items-center justify-between gap-3 rounded-xl border border-orange-500/30 bg-slate-900/95 px-4 py-2.5 shadow-lg shadow-orange-500/5 backdrop-blur",
        "motion-safe:transition-all motion-safe:duration-200",
        "data-[visible=false]:pointer-events-none data-[visible=false]:-translate-y-2 data-[visible=false]:opacity-0",
        "data-[visible=true]:translate-y-0 data-[visible=true]:opacity-100",
      )}
    >
      <div className="flex items-center gap-2 text-sm text-slate-200">
        <span className="font-semibold text-orange-400">{selectedCount}</span>
        <span>
          {itemNoun} đã chọn
        </span>
        <button
          type="button"
          onClick={onClearSelection}
          className="ml-2 text-xs text-slate-500 hover:text-slate-300"
        >
          Bỏ chọn
        </button>
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}
