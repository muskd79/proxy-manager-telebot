"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRole } from "@/lib/role-context";
import { ProxyFilters } from "@/components/proxies/proxy-filters";
import { ProxyTable } from "@/components/proxies/proxy-table";
import { ProxyForm } from "@/components/proxies/proxy-form";
import { ProxyBulkEdit } from "@/components/proxies/proxy-bulk-edit";
import { ProxySubTabs } from "@/components/proxies/proxy-sub-tabs";
// Wave 22C: ProxyTagManager removed — strong categories replace flat tags.
// Use /categories admin page to manage groupings; the proxies list now
// filters by ?category_id=X (mig 028 + Wave 22A/B).
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Plus,
  Upload,
  Download,
  Trash2,
  Activity,
  RefreshCw,
  Zap,
  Loader2,
  Pencil,
  ChevronDown,
  FileText,
  FileSpreadsheet,
  ClipboardPaste,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRouter } from "next/navigation";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Pagination } from "@/components/shared/pagination";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ProxyFilters as ProxyFiltersType } from "@/types/api";
import type { Proxy } from "@/types/database";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";

export default function ProxiesPage() {
  const { t } = useI18n();
  const { canWrite } = useRole();
  const router = useRouter();
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [countries, setCountries] = useState<string[]>([]);
  // Wave 22Z — categories list for the new Danh mục filter dropdown.
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editProxy, setEditProxy] = useState<Proxy | null>(null);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkProgress, setCheckProgress] = useState(0);
  const [lastCheckTime, setLastCheckTime] = useState<string | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  const [filters, setFilters] = useState<ProxyFiltersType>({
    page: 1,
    pageSize: 20,
    sortBy: "created_at",
    sortOrder: "desc",
  });

  const fetchProxies = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.search) params.set("search", filters.search);
      if (filters.type) params.set("type", filters.type);
      if (filters.status) params.set("status", filters.status);
      if (filters.country) params.set("country", filters.country);
      if (filters.networkType) params.set("networkType", filters.networkType);
      if (filters.expiryStatus) params.set("expiryStatus", filters.expiryStatus);
      // Wave 22Z — category filter wired through to ?category_id=
      if (filters.categoryId) params.set("category_id", filters.categoryId);
      // Wave 22C: tags param removed — categories filter via ?category_id=X.
      // Wave 22Y — isp filter param removed (column dropped from UI)
      params.set("page", String(filters.page || 1));
      params.set("pageSize", String(filters.pageSize || 20));
      params.set("sortBy", filters.sortBy || "created_at");
      params.set("sortOrder", filters.sortOrder || "desc");

      const res = await fetch(`/api/proxies?${params.toString()}`);
      if (res.ok) {
        const result = await res.json();
        setProxies(result.data || []);
        setTotal(result.total || 0);
        setTotalPages(result.totalPages || 0);
      }
    } catch (err) {
      console.error("Failed to fetch proxies:", err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const fetchCountries = useCallback(async () => {
    try {
      const res = await fetch("/api/proxies/stats");
      if (res.ok) {
        const result = await res.json();
        const byCountry = result.data?.byCountry || {};
        setCountries(Object.keys(byCountry).sort());
      }
    } catch (err) {
      console.error("Failed to fetch proxy countries:", err);
    }
  }, []);

  // Wave 22Z — fetch categories once on mount for the filter dropdown.
  // Excludes hidden categories (default behaviour of /api/categories).
  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/categories");
      if (res.ok) {
        const result = await res.json();
        const list = Array.isArray(result?.data) ? result.data : [];
        setCategories(
          list.map((c: { id: string; name: string }) => ({
            id: c.id,
            name: c.name,
          })),
        );
      }
    } catch (err) {
      console.error("Failed to fetch categories:", err);
    }
  }, []);

  useEffect(() => {
    fetchProxies();
  }, [fetchProxies]);

  useEffect(() => {
    fetchCountries();
    fetchCategories();
  }, [fetchCountries, fetchCategories]);

  // Keyboard shortcuts
  useEffect(() => {
    const isInputFocused = (): boolean => {
      const active = document.activeElement;
      return (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        active?.getAttribute("contenteditable") === "true"
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + A: Select all visible proxies
      if ((e.ctrlKey || e.metaKey) && e.key === "a" && !isInputFocused()) {
        e.preventDefault();
        const allIds = proxies.map((p) => p.id);
        setSelectedIds(allIds);
      }

      // Escape: Deselect all
      if (e.key === "Escape" && selectedIds.length > 0) {
        setSelectedIds([]);
      }

      // Delete/Backspace: Trigger bulk delete (if items selected)
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedIds.length > 0 &&
        !isInputFocused()
      ) {
        e.preventDefault();
        setShowBulkDeleteConfirm(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [proxies, selectedIds]);

  // Realtime sync: re-fetch when proxies table changes (debounced to reduce load)
  const proxiesDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("proxies-changes")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase JS realtime API does not export the literal union type for the event name
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "proxies" }, () => {
        // Debounce: only re-fetch after 2s of no changes
        clearTimeout(proxiesDebounceRef.current);
        proxiesDebounceRef.current = setTimeout(() => {
          fetchProxies();
        }, 2000);
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.error('Realtime subscription error on proxies channel');
        }
      });

    return () => {
      clearTimeout(proxiesDebounceRef.current);
      channel.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [fetchProxies]);

  function handleSort(column: string) {
    setFilters((prev) => ({
      ...prev,
      sortBy: column,
      sortOrder:
        prev.sortBy === column && prev.sortOrder === "asc" ? "desc" : "asc",
      page: 1,
    }));
  }

  async function handleSaveProxy(data: Record<string, unknown>) {
    const url = editProxy ? `/api/proxies/${editProxy.id}` : "/api/proxies";
    const method = editProxy ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      throw new Error("Failed to save proxy");
    }

    setEditProxy(null);
    fetchProxies();
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/proxies/${id}`, { method: "DELETE" });
    if (res.ok) {
      fetchProxies();
      setSelectedIds((prev) => prev.filter((x) => x !== id));
    }
  }

  // Wave 22X — bulk delete with error tally + summary toast.
  // Pre-fix: silent for-loop; if request #50 of 100 failed the user
  // saw nothing and the list desynced. Now run all in parallel via
  // allSettled and report exact counts.
  async function handleBulkDelete() {
    if (selectedIds.length === 0) return;
    const results = await Promise.allSettled(
      selectedIds.map((id) =>
        fetch(`/api/proxies/${id}`, { method: "DELETE" }).then(async (r) => {
          if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${r.status}`);
          }
        }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - ok;
    if (failed === 0) {
      toast.success(`Đã chuyển ${ok} proxy vào Thùng rác`);
    } else if (ok === 0) {
      toast.error(`Xoá thất bại cho cả ${failed} proxy`);
    } else {
      toast.warning(`Xoá thành công ${ok}/${results.length} (${failed} lỗi)`);
    }
    setSelectedIds([]);
    fetchProxies();
  }

  async function handleHealthCheck(ids: string[]) {
    await fetch("/api/proxies/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    fetchProxies();
  }

  const handleCheckAll = async () => {
    if (!canWrite) return;
    setChecking(true);
    setCheckProgress(0);
    try {
      // Get all proxy IDs — capped at 500 to avoid unbounded memory/DB load.
      // For fleets >500 proxies use the cron health-check endpoint instead.
      const res = await fetch("/api/proxies?pageSize=500");
      const result = await res.json();
      const rawData = result?.data?.data || result?.data || [];
      const allIds = (Array.isArray(rawData) ? rawData : []).map((p: any) => p.id);

      if (allIds.length === 0) {
        toast.info(t("proxies.noProxiesToCheck"));
        return;
      }

      // Check in batches of 100
      const batchSize = 100;
      for (let i = 0; i < allIds.length; i += batchSize) {
        const batch = allIds.slice(i, i + batchSize);
        await fetch("/api/proxies/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: batch }),
        });
        setCheckProgress(Math.round(((i + batch.length) / allIds.length) * 100));
      }

      toast.success(t("proxies.healthCheckComplete").replace("{count}", String(allIds.length)));
      setLastCheckTime(new Date().toLocaleTimeString());
      fetchProxies(); // refresh list
    } catch (err) {
      console.error("Health check failed:", err);
      toast.error(t("proxies.healthCheckFailed"));
    } finally {
      setChecking(false);
      setCheckProgress(0);
    }
  };

  function handleExport(format: "csv" | "json") {
    window.open(`/api/proxies/export?format=${format}`, "_blank");
  }

  return (
    <div className="flex-1 space-y-4 p-4 sm:space-y-6 sm:p-6">
      {/* Wave 22T — sub-tabs nested under Quản lý proxy. */}
      <ProxySubTabs />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("sidebar.proxies")}</h1>
          <p className="text-muted-foreground">
            {t("proxies.subtitle")} ({total} {t("proxies.total")})
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport("csv")}
          >
            <Download className="size-4 mr-1.5" />
            CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport("json")}
          >
            <Download className="size-4 mr-1.5" />
            JSON
          </Button>
          {canWrite && (
            // Wave 22Y — unified "+ Thêm proxy" dropdown replaces the
            // two separate buttons (Plus + Upload) per user request.
            // Mirrors the "Thêm Via" pattern from the sibling project:
            //   - Thêm đơn       → ProxyForm dialog (single create)
            //   - Nhập hàng loạt → /proxies/import (paste textarea)
            //   - Nhập file (.txt) / Nhập CSV → /proxies/import (file upload)
            // The wizard at /proxies/import already supports all three
            // input modes, so no new route is needed.
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="sm" variant="default">
                    <Plus className="size-4 mr-1.5" />
                    Thêm proxy
                    <ChevronDown className="size-3.5 ml-1" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  onClick={() => {
                    setEditProxy(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus className="size-4 mr-2" />
                  Thêm đơn
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/proxies/import?mode=paste")}>
                  <ClipboardPaste className="size-4 mr-2" />
                  Nhập hàng loạt
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/proxies/import?mode=txt")}>
                  <FileText className="size-4 mr-2" />
                  Nhập file (.txt)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/proxies/import?mode=csv")}>
                  <FileSpreadsheet className="size-4 mr-2" />
                  Nhập CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Health Check Status */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Activity className="size-4" />
        <span>{t("proxies.lastCheck")}: {lastCheckTime || t("proxies.never")}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCheckAll}
          disabled={checking}
        >
          {checking ? (
            <>
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              {t("proxies.checking")} ({checkProgress}%)
            </>
          ) : (
            <>
              <Zap className="size-3.5 mr-1.5" />
              {t("proxies.checkAllProxies")}
            </>
          )}
        </Button>
      </div>

      {/* Wave 22C: tag manager removed — see /categories for groupings */}

      <ProxyFilters
        filters={filters}
        onFiltersChange={setFilters}
        countries={countries}
        categories={categories}
      />

      {/* Bulk actions */}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-2">
          <span className="text-sm text-muted-foreground">
            {t("proxies.selected").replace("{count}", String(selectedIds.length))}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleHealthCheck(selectedIds)}
          >
            <Activity className="size-4 mr-1" />
            {t("proxies.healthCheck")}
          </Button>
          {canWrite && (
            <>
              <Button variant="outline" size="sm" onClick={() => setBulkEditOpen(true)}>
                <Pencil className="size-4 mr-1" />
                {t("common.edit")} ({selectedIds.length})
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setShowBulkDeleteConfirm(true)} title="Delete selected (Delete)">
                <Trash2 className="size-4 mr-1" />
                {t("common.delete")}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedIds([])}
            title="Deselect all (Esc)"
          >
            {t("proxies.clear")}
          </Button>
          <span className="text-xs text-muted-foreground ml-2">
            Ctrl+A: Select all | Esc: Deselect | Del: Delete
          </span>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        {loading ? (
          <TableSkeleton columns={7} rows={10} />
        ) : (
          <ProxyTable
            proxies={proxies}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            onSort={handleSort}
            sortBy={filters.sortBy || "created_at"}
            sortOrder={filters.sortOrder || "desc"}
            onEdit={(proxy) => {
              setEditProxy(proxy);
              setFormOpen(true);
            }}
            onDelete={handleDelete}
            onHealthCheck={handleHealthCheck}
          />
        )}
      </div>

      {/* Pagination */}
      <Pagination
        page={filters.page || 1}
        pageSize={filters.pageSize || 20}
        total={total}
        totalPages={totalPages}
        onPageChange={(p) => setFilters((prev) => ({ ...prev, page: p }))}
        onPageSizeChange={(size) => setFilters((prev) => ({ ...prev, pageSize: size, page: 1 }))}
      />

      <ProxyForm
        open={formOpen}
        onOpenChange={setFormOpen}
        proxy={editProxy}
        onSave={handleSaveProxy}
      />

      <ProxyBulkEdit
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        selectedIds={selectedIds}
        onComplete={() => { setSelectedIds([]); fetchProxies(); }}
      />

      {/* Bulk Delete Confirmation */}
      <AlertDialog
        open={showBulkDeleteConfirm}
        onOpenChange={setShowBulkDeleteConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("proxies.deleteProxies")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("proxies.deleteProxiesConfirm").replace("{count}", String(selectedIds.length))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowBulkDeleteConfirm(false);
                handleBulkDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
