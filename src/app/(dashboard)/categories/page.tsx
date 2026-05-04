"use client";

/**
 * Wave 27 PR-2 + PR-3 — categories page (card grid + bulk actions
 * + realtime).
 *
 * PR-2 baseline: 3-col responsive grid, click-to-detail, +Tạo CTA.
 * PR-3 additions:
 *   - Sticky bulk-action toolbar (Hide / Show / Delete)
 *   - Bulk delete confirm dialog
 *   - Realtime debounced refetch on `proxy_categories` + `proxies`
 *     row changes (per-table channels per UX-12)
 *
 * Out of scope (defer):
 *   - Filter chips (visible/hidden/empty/sort)
 *   - Pencil-edit per card (user navigates to detail page to edit)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { CategoryFormDialog } from "@/components/categories/CategoryFormDialog";
import { ProxySubTabs } from "@/components/proxies/proxy-sub-tabs";
import { CategoryGrid } from "@/components/categories/category-grid";
import { BulkActionToolbar } from "@/components/categories/bulk-action-toolbar";
import { createClient } from "@/lib/supabase/client";
import { useUrlFilters } from "@/lib/hooks/use-url-filters";
import type {
  CategoryDashboardRow,
  CategoryRow,
} from "@/lib/categories/types";

interface DashboardResponse {
  success: boolean;
  data?: CategoryDashboardRow[];
  error?: string;
}

// Wave 27 UX-2 — URL-bound filter codec for /categories.
// Only `includeHidden` today; will grow when filter chips ship.
interface CategoryPageFilters {
  includeHidden: boolean;
}
const DEFAULT_CATEGORY_FILTERS: CategoryPageFilters = { includeHidden: false };

function parseCategoryFilters(p: URLSearchParams): CategoryPageFilters {
  return {
    includeHidden: p.get("includeHidden") === "1",
  };
}
function formatCategoryFilters(f: CategoryPageFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.includeHidden) p.set("includeHidden", "1");
  return p;
}

export default function CategoriesPage() {
  const [rows, setRows] = useState<CategoryDashboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Wave 27 UX-2 — filter state mirrored to URL so admins can
  // bookmark/share filtered views and reload preserves intent.
  const [filters, setFilters] = useUrlFilters({
    parse: parseCategoryFilters,
    format: formatCategoryFilters,
    defaults: DEFAULT_CATEGORY_FILTERS,
  });
  const includeHidden = filters.includeHidden;
  const setIncludeHidden = useCallback(
    (next: boolean) => setFilters((prev) => ({ ...prev, includeHidden: next })),
    [setFilters],
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

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

  // Wave 27 PR-3d — realtime debounced refetch.
  //
  // Two channels (proxy_categories + proxies) — both can change the
  // dashboard view (count drift, status flip, etc). Debounce 2s
  // (perf agent's recommendation — under flood we don't want
  // per-event refetch). Single fetchClaims-style ref so the
  // subscription doesn't re-create on every render.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("categories-dashboard")
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "proxy_categories" },
        () => {
          clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => loadRef.current?.(), 2000);
        },
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "proxies" },
        () => {
          clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => loadRef.current?.(), 2000);
        },
      )
      .subscribe();
    return () => {
      clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, []);

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

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function clearFilters() {
    setIncludeHidden(true);
  }

  function openCreateDialog() {
    setEditing(null);
    setFormOpen(true);
  }

  // ─── Bulk actions ───────────────────────────────────────────────
  // Pattern from Wave 26-D bug hunt v2 [MEDIUM]: split toast on
  // partial success, retain failed IDs in selection so admin can
  // retry without rebuilding the selection.

  /**
   * Wave 27 bug hunt v6 [debugger #8, MEDIUM] — fan out bulk PATCH/DELETE
   * via Promise.allSettled instead of awaiting each in a sequential
   * for-loop. Pre-fix: 20 categories × ~200ms RTT = 4s blocked UI.
   * Now: dominated by slowest single request (~500ms typical). Same
   * partial-success handling preserved.
   */
  async function runBulk(
    ids: string[],
    perItem: (id: string) => Promise<Response>,
  ): Promise<{ successCount: number; failedIds: string[] }> {
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const res = await perItem(id);
        return { id, ok: res.ok };
      }),
    );
    const failedIds: string[] = [];
    let successCount = 0;
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.ok) {
        successCount++;
      } else if (r.status === "fulfilled") {
        failedIds.push(r.value.id);
      } else {
        // Promise rejected (network throw) — we don't have the id back,
        // so we mark all otherwise-unaccounted ids as failed at end.
        // In practice this branch is rare since fetch() resolves on
        // HTTP errors instead of rejecting; rejection means transport.
      }
    }
    // Backfill: any id whose Promise.allSettled entry rejected without
    // a fulfilled value gets marked failed. This is a defensive safety
    // net for runtime-only rejections (DNS, abort, etc).
    const seenIds = new Set<string>();
    results.forEach((r) => {
      if (r.status === "fulfilled") seenIds.add(r.value.id);
    });
    for (const id of ids) {
      if (!seenIds.has(id) && !failedIds.includes(id)) {
        failedIds.push(id);
      }
    }
    return { successCount, failedIds };
  }

  async function bulkSetHidden(targetHidden: boolean) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    const { successCount, failedIds } = await runBulk(ids, (id) =>
      fetch(`/api/categories/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_hidden: targetHidden }),
      }),
    );
    setBulkBusy(false);
    setSelectedIds(new Set(failedIds));
    if (successCount > 0 && failedIds.length === 0) {
      toast.success(
        `Đã ${targetHidden ? "ẩn" : "hiện"} ${successCount}/${ids.length} danh mục`,
      );
    } else if (successCount > 0) {
      toast.warning(
        `${targetHidden ? "Ẩn" : "Hiện"} ${successCount} thành công, ${failedIds.length} thất bại — đã giữ lại các danh mục lỗi để bạn thử lại.`,
      );
    } else {
      toast.error(
        `Không ${targetHidden ? "ẩn" : "hiện"} được danh mục nào (${failedIds.length} lỗi).`,
      );
    }
    await load();
  }

  async function bulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    const { successCount, failedIds } = await runBulk(ids, (id) =>
      fetch(`/api/categories/${id}`, { method: "DELETE" }),
    );
    setBulkBusy(false);
    setSelectedIds(new Set(failedIds));
    setBulkDeleteOpen(false);
    if (successCount > 0 && failedIds.length === 0) {
      toast.success(`Đã xoá ${successCount}/${ids.length} danh mục`);
    } else if (successCount > 0) {
      toast.warning(
        `Xoá ${successCount} thành công, ${failedIds.length} thất bại — đã giữ lại các danh mục lỗi để bạn thử lại.`,
      );
    } else {
      toast.error(`Không xoá được danh mục nào (${failedIds.length} lỗi).`);
    }
    await load();
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

      <BulkActionToolbar
        selectedCount={selectedIds.size}
        busy={bulkBusy}
        onClearSelection={clearSelection}
        onBulkHide={() => void bulkSetHidden(true)}
        onBulkShow={() => void bulkSetHidden(false)}
        onBulkDelete={() => setBulkDeleteOpen(true)}
      />

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

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        variant="destructive"
        title={`Xoá ${selectedIds.size} danh mục?`}
        description="Proxy thuộc các danh mục này sẽ chuyển về trạng thái KHÔNG PHÂN LOẠI (không xoá proxy). Hành động này không thể hoàn tác."
        confirmText={bulkBusy ? "Đang xoá..." : `Xoá ${selectedIds.size} danh mục`}
        cancelText="Huỷ"
        onConfirm={bulkDelete}
      />
    </div>
  );
}
