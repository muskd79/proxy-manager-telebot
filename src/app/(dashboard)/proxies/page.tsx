"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRole } from "@/lib/role-context";
import { ProxyFilters } from "@/components/proxies/proxy-filters";
import { useSharedQuery } from "@/lib/shared-cache";
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
  AlertCircle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRouter, useSearchParams } from "next/navigation";
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
// Wave 27 UX-4 — adopt shared BulkActionBar shell. Local copy had
// drift around clear-button styling (variant="ghost" vs unset) and
// kept its own Esc/Ctrl-A hint inline. Hint moved to a tooltip on
// the count label so the visual surface matches /categories +
// /trash/*.
import { BulkActionBar } from "@/components/shared/bulk-action-bar";

export default function ProxiesPage() {
  const { t } = useI18n();
  const { canWrite } = useRole();
  const router = useRouter();
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  // Wave 26-C (gap 6.3) — countries + categories now flow from the
  // shared cache instead of page-local state. Pre-fix the page, the
  // Sửa form, and the Import wizard each fetched the same two
  // endpoints on mount — three identical calls per session. Now the
  // first reader populates the cache; the rest are zero-network.
  const { data: stats } = useSharedQuery<{
    countries?: string[];
    byCountry?: Record<string, number>;
  }>("api:proxies:stats", async () => {
    const r = await fetch("/api/proxies/stats");
    if (!r.ok) return {};
    const d = await r.json();
    return (d?.data ?? {}) as {
      countries?: string[];
      byCountry?: Record<string, number>;
    };
  });
  const countries: string[] = stats?.byCountry
    ? Object.keys(stats.byCountry).sort()
    : stats?.countries ?? [];

  const { data: categoriesFromCache } = useSharedQuery<
    Array<{
      id: string;
      name: string;
      default_country?: string | null;
      default_proxy_type?: string | null;
      default_isp?: string | null;
      default_network_type?: string | null;
    }>
  >("api:categories:full", async () => {
    const r = await fetch("/api/categories");
    if (!r.ok) return [];
    const result = await r.json();
    return Array.isArray(result?.data) ? result.data : [];
  });
  const categories: { id: string; name: string }[] = (categoriesFromCache ?? []).map((c) => ({
    id: c.id,
    name: c.name,
  }));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editProxy, setEditProxy] = useState<Proxy | null>(null);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkProgress, setCheckProgress] = useState(0);
  const [lastCheckTime, setLastCheckTime] = useState<string | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  // Wave 26-B (gap 2.1) — replace window.confirm with shadcn AlertDialog
  // for visual consistency with bulk delete. Holds the proxy queued
  // for deletion; null = no dialog.
  const [singleDeleteTarget, setSingleDeleteTarget] = useState<Proxy | null>(
    null,
  );
  // Wave 26-B (gap 2.5) — soft banner when realtime drops. Pre-fix
  // CHANNEL_ERROR was console.error only — admin had no visual cue
  // that the auto-refresh on DB changes had stopped.
  // Wave 26-C — fixed false-positive on cleanup CLOSED + admin-driven
  // reconnect via realtimeKey bump (see useEffect below).
  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "ok" | "error">(
    "connecting",
  );
  // Bumping this state forces the realtime useEffect to tear down and
  // re-subscribe — the path the "Tải lại" button takes.
  const [realtimeKey, setRealtimeKey] = useState(0);

  // Phase 3 (PM UX) — read ?status= / ?type= / ?category_id= from
  // URL on first mount so dashboard KPI drill-down lands on a
  // pre-filtered view. Pre-fix admin had to click the card AND
  // re-filter by hand.
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<ProxyFiltersType>(() => ({
    page: 1,
    pageSize: 20,
    sortBy: "created_at",
    sortOrder: "desc",
    status: (searchParams.get("status") as ProxyFiltersType["status"]) || undefined,
    type: (searchParams.get("type") as ProxyFiltersType["type"]) || undefined,
    categoryId: searchParams.get("category_id") || undefined,
    // Wave 26-C — pre-load the import-batch filter so the post-import
    // CTA "/proxies?import_batch_id=<uuid>" lands on a filtered view
    // without an extra client tick. UUID-shape regex guards against
    // junk URL params (the API also validates, but bouncing here
    // keeps the banner from rendering for malformed IDs).
    importBatchId:
      (() => {
        const v = searchParams.get("import_batch_id");
        return v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined;
      })(),
  }));

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
      // Wave 26-C — import batch filter (UUID).
      if (filters.importBatchId)
        params.set("import_batch_id", filters.importBatchId);
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

  // Wave 26-C — fetchCountries + fetchCategories removed. The data
  // now flows from useSharedQuery (above) which handles fetch +
  // dedupe + cache for the dashboard-wide audience.

  useEffect(() => {
    fetchProxies();
  }, [fetchProxies]);

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
    // Wave 26-C — fix realtime banner false positive (user report
    // 2026-05-03: banner showed even on first load with no actual
    // failure). Two root causes:
    //
    // 1. fetchProxies is a useCallback whose identity changes on every
    //    `filters` mutation. The effect's [fetchProxies] dep meant
    //    every filter tweak tore down + re-subscribed the channel.
    //    The teardown's `channel.unsubscribe()` invokes the subscribe
    //    callback ONE more time with status="CLOSED" — pre-fix we
    //    treated that as an error and flipped the banner on. Now
    //    only CHANNEL_ERROR or TIMED_OUT count as real errors;
    //    CLOSED (intentional teardown) does NOT.
    //
    // 2. The status callback ran AFTER the effect cleanup function
    //    started executing — racing with the next effect's setup.
    //    An `isCancelled` flag now gates state updates so a stale
    //    callback can't flip the banner on a freshly-mounted instance.
    //
    // Also: drop fetchProxies from the dep array. The channel only
    // needs to fire fetchProxies on a postgres_changes event; we
    // grab the LATEST fetchProxies via a ref so the channel stays
    // subscribed across filter changes (no more teardown thrash).
    let isCancelled = false;
    const supabase = createClient();
    const channel = supabase
      .channel("proxies-changes")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase JS realtime API does not export the literal union type for the event name
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "proxies" }, () => {
        // Debounce: only re-fetch after 2s of no changes
        clearTimeout(proxiesDebounceRef.current);
        proxiesDebounceRef.current = setTimeout(() => {
          fetchProxiesRef.current?.();
        }, 2000);
      })
      .subscribe((status) => {
        if (isCancelled) return; // stale callback after cleanup — drop
        if (status === "SUBSCRIBED") {
          setRealtimeStatus("ok");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("Realtime subscription error on proxies channel:", status);
          setRealtimeStatus("error");
        }
        // CLOSED intentionally NOT treated as error — it's the normal
        // status emitted during cleanup. We can't always tell apart
        // server-side disconnects from voluntary teardown via the
        // status alone; CHANNEL_ERROR / TIMED_OUT are the only
        // statuses that unambiguously mean "real problem".
      });

    return () => {
      isCancelled = true;
      clearTimeout(proxiesDebounceRef.current);
      channel.unsubscribe();
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtimeKey]);

  // Wave 26-C — keep the realtime callback pointing at the latest
  // fetchProxies (which closes over the latest filters). Without
  // this ref the channel would fire a stale fetch with stale filters.
  const fetchProxiesRef = useRef<typeof fetchProxies>(fetchProxies);
  useEffect(() => {
    fetchProxiesRef.current = fetchProxies;
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

  // Wave 26-B (gap 2.1) — replace window.confirm with AlertDialog.
  // `handleDelete` now opens the dialog; the actual delete runs
  // in `confirmSingleDelete` when admin confirms. UX matches the
  // bulk-delete flow (same component, same theming).
  function handleDelete(id: string) {
    const proxy = proxies.find((p) => p.id === id);
    if (!proxy) return;
    setSingleDeleteTarget(proxy);
  }

  async function confirmSingleDelete() {
    const proxy = singleDeleteTarget;
    if (!proxy) return;
    const label = `${proxy.host}:${proxy.port}`;
    const proxyId = proxy.id;
    setSingleDeleteTarget(null);

    const res = await fetch(`/api/proxies/${proxyId}`, { method: "DELETE" });
    if (res.ok) {
      // Wave 26-B (gap 6.6) — toast with Undo action. Soft-delete via
      // /api/proxies/[id] PATCH { is_deleted: false } restores from
      // Trash. 8s window covers a typical "wait, that was the wrong
      // row" moment.
      toast.success(`Đã chuyển ${label} vào Thùng rác`, {
        duration: 8000,
        action: {
          label: "Hoàn tác",
          onClick: async () => {
            // Wave 26-B (gap 6.6) — PUT with is_deleted=false. The
            // /api/proxies/[id] PUT route accepts a partial body and
            // restores soft-deleted rows when is_deleted goes false-
            // ward (also clears deleted_at server-side).
            const undoRes = await fetch(`/api/proxies/${proxyId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ is_deleted: false }),
            });
            if (undoRes.ok) {
              toast.success(`Đã khôi phục ${label}`);
              fetchProxies();
            } else {
              const body = await undoRes.json().catch(() => ({}));
              toast.error(`Không khôi phục được: ${body?.error || undoRes.statusText}`);
            }
          },
        },
      });
      fetchProxies();
      setSelectedIds((prev) => prev.filter((x) => x !== proxyId));
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error(`Xoá thất bại: ${body?.error || res.statusText}`);
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

  // Wave 26-B (gap 2.4 + 2.8 + 6.4) — health-check now toasts the
  // alive/dead summary, optimistically updates the row(s) in local
  // state from the API response (instant UI feedback, no full refetch
  // wait), and refreshes the "Lần check gần nhất" timestamp so the
  // status indicator is honest about all checks (not just check-all).
  async function handleHealthCheck(ids: string[]) {
    if (ids.length === 0) return;
    try {
      const res = await fetch("/api/proxies/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(`Kiểm tra thất bại: ${body?.error || res.statusText}`);
        return;
      }
      const body = await res.json();
      type CheckRow = { id: string; alive: boolean; speed_ms: number };
      // /api/proxies/check returns `data: [...]` directly, not
      // `data.results`. Defensive parsing in case the route shape
      // ever changes.
      const rows: CheckRow[] = Array.isArray(body?.data)
        ? body.data
        : Array.isArray(body?.data?.results)
          ? body.data.results
          : [];

      // Optimistic update: patch the rows in-place. No full refetch
      // means the table doesn't flicker for a single-row check.
      // The check endpoint flips `status` → "maintenance" for dead
      // proxies but leaves alive proxies' status alone, so we
      // mirror that here.
      if (rows.length > 0) {
        const nowISO = new Date().toISOString();
        setProxies((prev) =>
          prev.map((p) => {
            const r = rows.find((x) => x.id === p.id);
            if (!r) return p;
            return {
              ...p,
              speed_ms: r.alive ? r.speed_ms : null,
              last_checked_at: nowISO,
              status: !r.alive ? "maintenance" : p.status,
            };
          }),
        );
      } else {
        // Endpoint didn't return per-row results — fall back to a
        // refetch so the table eventually reflects the new state.
        fetchProxies();
      }

      // Toast summary based on returned rows (or fallback count).
      const aliveN = rows.filter((r) => r.alive === true).length;
      const deadN = rows.filter((r) => r.alive === false).length;
      const totalN = rows.length || ids.length;
      toast.success(
        `Đã kiểm tra ${totalN}` +
          (rows.length > 0 ? ` — ${aliveN} alive, ${deadN} dead` : ""),
      );
      setLastCheckTime(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("Health check failed:", err);
      toast.error("Kiểm tra thất bại — lỗi mạng");
    }
  }

  const handleCheckAll = async () => {
    if (!canWrite) return;
    setChecking(true);
    setCheckProgress(0);
    const CHECK_ALL_CAP = 500;
    try {
      // Get all proxy IDs — capped at CHECK_ALL_CAP to avoid unbounded
      // memory/DB load. For fleets >cap use the cron health-check
      // endpoint instead.
      const res = await fetch(`/api/proxies?pageSize=${CHECK_ALL_CAP}`);
      const result = await res.json();
      const rawData = result?.data?.data || result?.data || [];
      const allIds = (Array.isArray(rawData) ? rawData : []).map((p: any) => p.id);

      if (allIds.length === 0) {
        toast.info(t("proxies.noProxiesToCheck"));
        return;
      }

      // Wave 26-B (gap 2.3) — surface the cap. Pre-fix when total > cap
      // we silently checked only the first 500 and the success toast
      // claimed "Đã check 500" with no warning that the rest was
      // skipped. Now: explicit pre-flight warning so admins know to
      // run the cron job for the full fleet.
      const fleetCount = result?.total ?? allIds.length;
      if (typeof fleetCount === "number" && fleetCount > CHECK_ALL_CAP) {
        toast.warning(
          `Bot có ${fleetCount} proxy nhưng chỉ kiểm tra ${CHECK_ALL_CAP} proxy mới nhất một lần. ` +
            `Dùng cron health-check (24h/lần) cho toàn bộ fleet.`,
          { duration: 9000 },
        );
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

      {/* Wave 26-B (gap 2.5) — soft realtime status banner. Renders
          ONLY when the channel is in error state — happy path stays
          clean. The "Tải lại" button forces a full refetch + a fresh
          channel subscribe via useEffect cleanup + remount, which is
          the simplest path to recovery without a heavier reconnect
          retry loop. */}
      {realtimeStatus === "error" && (
        <div className="flex items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
          <AlertCircle className="size-4 shrink-0" />
          <span className="flex-1">
            Đồng bộ realtime tạm dừng — danh sách có thể không phản ánh thay đổi mới nhất.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              // Wave 26-C — explicit reconnect: bump realtimeKey to
              // tear down the dead channel and create a fresh one.
              // Also kick off a manual fetch so the table immediately
              // reflects whatever changed during the outage.
              setRealtimeStatus("connecting");
              setRealtimeKey((k) => k + 1);
              fetchProxies();
            }}
            className="h-7 gap-1.5 text-xs"
          >
            <RefreshCw className="size-3" />
            Tải lại
          </Button>
        </div>
      )}

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

      {/* Wave 26-C — import-batch filter banner. Renders only when the
          URL carries a valid `import_batch_id`. Pre-fix admins arrived
          on /proxies via the post-import CTA but had no visible cue
          they were on a filtered view; the row count just looked
          smaller than expected. Now: explicit chip with row count +
          one-click clear button. */}
      {filters.importBatchId && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 dark:border-blue-800 dark:bg-blue-950/40"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-blue-900 dark:text-blue-100">
              Đang lọc theo lô import
            </span>
            <code className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-xs text-blue-900 dark:bg-blue-900/60 dark:text-blue-100">
              {filters.importBatchId.slice(0, 8)}…
            </code>
            <span className="text-muted-foreground">
              ({total} proxy{total === 0 ? " — không khớp" : ""})
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setFilters((prev) => ({ ...prev, importBatchId: undefined, page: 1 }));
              // Strip the URL param so reload / share doesn't bring it back.
              router.replace("/proxies");
            }}
          >
            Xoá lọc
          </Button>
        </div>
      )}

      <ProxyFilters
        filters={filters}
        onFiltersChange={setFilters}
        countries={countries}
        categories={categories}
      />

      {/* Bulk actions — shared BulkActionBar shell.
          Keyboard shortcuts (Ctrl+A select-all, Esc deselect, Del delete)
          stay wired in the page-level keydown handler above; hint moved
          to a tooltip via title=… on the bar so the visual surface
          matches /categories + /trash/*. */}
      <BulkActionBar
        selectedCount={selectedIds.length}
        itemNoun="proxy"
        onClearSelection={() => setSelectedIds([])}
        ariaLabel="Thao tác hàng loạt cho proxy đã chọn (Ctrl+A: chọn tất cả · Esc: bỏ chọn · Del: xoá)"
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleHealthCheck(selectedIds)}
            >
              <Activity className="size-4 mr-1" />
              {t("proxies.healthCheck")}
            </Button>
            {canWrite && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setBulkEditOpen(true)}>
                  <Pencil className="size-4 mr-1" />
                  {t("common.edit")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowBulkDeleteConfirm(true)}
                  title="Xoá đã chọn (Del)"
                >
                  <Trash2 className="size-4 mr-1" />
                  {t("common.delete")}
                </Button>
              </>
            )}
          </>
        }
      />


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

      {/* Wave 26-B (gap 2.1) — single proxy delete confirmation.
          Pre-fix used native window.confirm — different theming,
          jarring next to the AlertDialog bulk-delete. Now both flow
          through the same shadcn AlertDialog component. */}
      <AlertDialog
        open={singleDeleteTarget !== null}
        onOpenChange={(open) => !open && setSingleDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Chuyển vào Thùng rác?</AlertDialogTitle>
            <AlertDialogDescription>
              {singleDeleteTarget && (
                <>
                  Sắp chuyển <strong className="font-mono">{singleDeleteTarget.host}:{singleDeleteTarget.port}</strong> vào Thùng rác.
                  <br />
                  Có thể khôi phục từ tab Thùng rác trong vòng 30 ngày.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmSingleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Chuyển vào Thùng rác
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
