"use client";

/**
 * Wave 27 PR-3b — sticky bulk-action toolbar for the categories grid.
 *
 * Slides in when at least one card is checked. Contains:
 *   - Selection count + "Bỏ chọn" button (left)
 *   - Action buttons (right): Hide / Show / Delete
 *
 * Positioned `sticky top-4` so it stays visible while admin scrolls
 * through a long category grid. Delete uses ConfirmDialog (handled
 * by parent — toolbar just dispatches the intent).
 */

import { Eye, EyeOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BulkActionToolbarProps {
  selectedCount: number;
  /** True when actions are in flight; disables buttons. */
  busy?: boolean;
  onClearSelection: () => void;
  onBulkHide: () => void;
  onBulkShow: () => void;
  onBulkDelete: () => void;
}

export function BulkActionToolbar({
  selectedCount,
  busy = false,
  onClearSelection,
  onBulkHide,
  onBulkShow,
  onBulkDelete,
}: BulkActionToolbarProps) {
  const visible = selectedCount > 0;

  return (
    <div
      data-visible={visible}
      role="region"
      aria-label="Thao tác hàng loạt cho danh mục đã chọn"
      className={cn(
        "sticky top-4 z-30 mb-4 flex items-center justify-between gap-3 rounded-xl border border-orange-500/30 bg-slate-900/95 px-4 py-2.5 shadow-lg shadow-orange-500/5 backdrop-blur",
        "motion-safe:transition-all motion-safe:duration-200",
        "data-[visible=false]:pointer-events-none data-[visible=false]:-translate-y-2 data-[visible=false]:opacity-0",
        "data-[visible=true]:translate-y-0 data-[visible=true]:opacity-100",
      )}
    >
      <div className="flex items-center gap-2 text-sm text-slate-200">
        <span className="font-semibold text-orange-400">{selectedCount}</span>
        <span>danh mục đã chọn</span>
        <button
          type="button"
          onClick={onClearSelection}
          disabled={busy}
          className="ml-2 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-50"
        >
          Bỏ chọn
        </button>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={onBulkHide}
          disabled={busy}
        >
          <EyeOff className="mr-1.5 h-4 w-4" />
          Ẩn
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onBulkShow}
          disabled={busy}
        >
          <Eye className="mr-1.5 h-4 w-4" />
          Hiện
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={onBulkDelete}
          disabled={busy}
        >
          <Trash2 className="mr-1.5 h-4 w-4" />
          Xoá
        </Button>
      </div>
    </div>
  );
}
