"use client";

/**
 * Wave 27 PR-2 — categories page rewritten as card grid (was table).
 *
 * Visual goal: match the user's VIA Manager screenshot:
 *   - 3-column responsive grid of cards
 *   - Each card shows: visibility chip, name + count, description,
 *     stacked progress bar, status breakdown, money block
 *   - Click on card → /categories/[id] detail (read mode)
 *   - Edit dialog opened via "+ Tạo danh mục" button (top-right)
 *
 * Data source: GET /api/categories/dashboard (RPC).
 *
 * Out of scope for PR-2 (deferred to PR-3):
 *   - Bulk-select toolbar (sticky)
 *   - Realtime per-card updates
 *   - "Apply defaults retroactively" dialog (only_null + force)
 *   - Filter chips (visible/hidden/empty/all + sort)
 *   - Pencil-edit-on-card overflow menu (currently the Sửa button
 *     stays in the legacy form-trigger flow)
 *
 * Reorder + toggle-hidden + delete are kept available via the
 * `/api/categories` endpoints — wired up in PR-3 alongside the
 * three-dot menu per card.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CategoryFormDialog } from "@/components/categories/CategoryFormDialog";
import { ProxySubTabs } from "@/components/proxies/proxy-sub-tabs";
import { CategoryGrid } from "@/components/categories/category-grid";
import type {
  CategoryDashboardRow,
  CategoryRow,
} from "@/lib/categories/types";

interface DashboardResponse {
  success: boolean;
  data?: CategoryDashboardRow[];
  error?: string;
}

export default function CategoriesPage() {
  const [rows, setRows] = useState<CategoryDashboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/categories/dashboard", { cache: "no-store" });
      const body = (await res.json()) as DashboardResponse;
      if (!body.success) {
        toast.error(body.error ?? "Không tải được danh sách danh mục");
        return;
      }
      setRows(body.data ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lỗi mạng");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Clear stale selection IDs when underlying list changes (after refetch).
  useEffect(() => {
    setSelectedIds((prev) => {
      const valid = new Set<string>();
      for (const id of prev) {
        if (rows.some((r) => r.id === id)) valid.add(id);
      }
      return valid;
    });
  }, [rows]);

  const visibleRows = includeHidden ? rows : rows.filter((r) => !r.is_hidden);
  const hasActiveFilter = !includeHidden && rows.some((r) => r.is_hidden);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearFilters() {
    setIncludeHidden(true);
  }

  function openCreateDialog() {
    setEditing(null);
    setFormOpen(true);
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <ProxySubTabs />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Danh mục</h1>
          <p className="text-sm text-muted-foreground">
            Quản lý gom nhóm proxy theo nguồn / quốc gia / loại / giá. Khi
            thêm proxy vào danh mục, các giá trị mặc định (loại, quốc gia,
            ISP, giá) sẽ tự động được điền — chỉnh tay nếu cần.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={includeHidden}
              onChange={(e) => setIncludeHidden(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600"
              aria-label="Bao gồm danh mục đã ẩn"
            />
            Bao gồm danh mục đã ẩn
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Làm mới"
            className="min-h-11"
          >
            <RefreshCw className={loading ? "animate-spin" : undefined} />
            Làm mới
          </Button>
          <Button
            size="sm"
            onClick={openCreateDialog}
            className="bg-orange-500 hover:bg-orange-600 min-h-11"
          >
            <Plus />
            Tạo danh mục
          </Button>
        </div>
      </div>

      <CategoryGrid
        rows={visibleRows}
        isLoading={loading}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        hasActiveFilter={hasActiveFilter}
        onClearFilters={clearFilters}
        onCreateCategory={openCreateDialog}
      />

      <CategoryFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        category={editing}
        onSaved={() => {
          void load();
        }}
      />
    </div>
  );
}
