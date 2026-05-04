"use client";

/**
 * Wave 26-D-post1 — /requests page rebuild.
 *
 * User feedback (verbatim 2026-05-03):
 *   "tao chỉ cần 2 sub-tab này [Yêu cầu + Bảo hành] và mọi thứ có thể
 *    lọc và xem trong 2 sub-tab từ những yêu cầu đang đợi, yêu cầu đã
 *    từ chối, yêu cầu đã duyệt, … và lọc filter của 2 sub-tab cần thật
 *    sự mạnh"
 *
 * Pre-fix: page had 2 hardcoded tabs ("Chờ xử lý" / "Gần đây 7 ngày")
 * + 1 search input. Admin couldn't filter by date range, by approval
 * mode (auto vs manual), couldn't combine multiple statuses, no URL
 * state, no shareable filtered views.
 *
 * Now: single table + powerful filter row (5 dropdowns + search),
 * URL state encoded, default = "Đang đợi + 7 ngày" (the action queue),
 * bulk operations move OUT of the tab guard so admin can bulk-act on
 * any selection.
 *
 * Wave 26-D will repeat this pattern for /warranty (sibling page).
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  FileText,
  XCircle,
  Zap,
  RefreshCw,
} from "lucide-react";
import { useRole } from "@/lib/role-context";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RequestTable } from "@/components/requests/request-table";
import { Pagination } from "@/components/shared/pagination";
import { EmptyState } from "@/components/shared/empty-state";
// Wave 27 UX-4 — adopt shared BulkActionBar shell.
import { BulkActionBar } from "@/components/shared/bulk-action-bar";
import {
  ApproveDialog,
  RejectDialog,
  BatchApproveDialog,
} from "@/components/requests/request-actions";
import {
  RequestFilters,
  countActiveFilters,
  DEFAULT_REQUEST_FILTERS,
  type RequestPageFilters,
} from "@/components/requests/request-filters";
import {
  parseFiltersFromSearchParams,
  formatFiltersToSearchParams,
  resolveTimeBucket,
} from "@/components/requests/request-filters-url";
import type { ProxyRequest } from "@/types/database";
import type { RequestFilters as RequestFiltersType, PaginatedResponse, ApiResponse } from "@/types/api";
import { useI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { useSharedQuery } from "@/lib/shared-cache";

interface RequestWithUser extends ProxyRequest {
  tele_user?: {
    id: string;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    telegram_id: number;
  };
  admin?: {
    full_name: string | null;
    email: string;
  };
}

const PAGE_SIZE = 20;

export default function RequestsPage() {
  const { t } = useI18n();
  const { canWrite } = useRole();
  const router = useRouter();
  const searchParams = useSearchParams();

  // ─── Filter state (URL ↔ component) ──────────────────────────────
  const [filters, setFilters] = useState<RequestPageFilters>(() => {
    return parseFiltersFromSearchParams(
      new URLSearchParams(searchParams.toString()),
    );
  });
  // Pagination is intentionally NOT URL-bound — admins never bookmark
  // "page 7"; refresh-on-filter resets to 1 anyway.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  // Push filter state to URL whenever it changes. router.replace so we
  // don't pollute browser history with every dropdown tweak.
  useEffect(() => {
    const params = formatFiltersToSearchParams(filters);
    const url = params.toString() ? `/requests?${params.toString()}` : "/requests";
    router.replace(url, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // Reset page to 1 whenever filters change.
  useEffect(() => {
    setPage(1);
  }, [filters]);

  // Wave 26-D bug hunt v2 [P0-1] — clear stale selection when filter
  // changes. Pre-fix admin selected 5 rows, switched filter, the new
  // table view didn't have those IDs (so bulk bar hid via
  // pendingSelected.length === 0) but selectedIds still held the old
  // refs. handleBatchReject iterated selectedIds directly → PUT'd
  // against rows that may no longer be pending → admin saw "Đã từ
  // chối N/N" toast despite zero actual effect.
  useEffect(() => {
    setSelectedIds([]);
  }, [filters]);

  // ─── Data state ────────────────────────────────────────────────
  const [requests, setRequests] = useState<RequestWithUser[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Dialogs
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [batchApproveOpen, setBatchApproveOpen] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string>("");

  // Country list — share with /proxies via Wave 26-C cache.
  const { data: stats } = useSharedQuery<{
    countries?: string[];
    byCountry?: Record<string, number>;
  }>("api:proxies:stats", async () => {
    const r = await fetch("/api/proxies/stats");
    if (!r.ok) return {};
    const d = await r.json();
    return (d?.data ?? {}) as { countries?: string[]; byCountry?: Record<string, number> };
  });
  const countries: string[] = stats?.byCountry
    ? Object.keys(stats.byCountry).sort()
    : stats?.countries ?? [];

  // ─── Fetch requests for the current filter window ─────────────────
  const fetchRequests = useCallback(async () => {
    setIsLoading(true);
    try {
      const apiParams = new URLSearchParams();

      // Status — translate "all" → omit. Otherwise pass through (server
      // already supports comma-separated values).
      if (filters.status !== "all") apiParams.set("status", filters.status);

      // Time bucket → dateFrom/dateTo
      const range = resolveTimeBucket(filters);
      if (range.dateFrom) apiParams.set("dateFrom", range.dateFrom);
      if (range.dateTo) apiParams.set("dateTo", range.dateTo);

      if (filters.proxyType !== "all") apiParams.set("proxyType", filters.proxyType);
      if (filters.approvalMode !== "all") apiParams.set("approvalMode", filters.approvalMode);
      if (filters.country) apiParams.set("country", filters.country);
      if (filters.search) apiParams.set("search", filters.search);

      apiParams.set("page", String(page));
      apiParams.set("pageSize", String(pageSize));
      apiParams.set("sortBy", "requested_at");
      apiParams.set("sortOrder", "desc");

      const res = await fetch(`/api/requests?${apiParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch requests");
      const json: ApiResponse<PaginatedResponse<RequestWithUser>> = await res.json();
      if (json.success && json.data) {
        setRequests(json.data.data);
        setTotal(json.data.total);
        setTotalPages(json.data.totalPages);
      }
    } catch (err) {
      console.error("Failed to load requests:", err);
      toast.error(t("requests.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [filters, page, pageSize, t]);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  // ─── Realtime: re-fetch on proxy_requests changes (debounced) ─────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fetchRef = useRef(fetchRequests);
  fetchRef.current = fetchRequests;
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("requests-changes")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase JS realtime API
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "proxy_requests" }, () => {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          fetchRef.current?.();
        }, 2000);
      })
      .subscribe();

    return () => {
      clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, []);

  // ─── Per-status counts (badge inside Trạng thái dropdown) ─────────
  // Cheap: 1 extra request that fetches counts grouped by status.
  // Falls back gracefully if endpoint doesn't exist (the badge just
  // disappears, no crash).
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Reuse the same /api/requests endpoint with pageSize=0 + group?
        // Simpler: fire 5 small requests in parallel with pageSize=1 each.
        // The total counter on each tells us bucket size without
        // pulling actual rows. Skip the time-window so the badge
        // reflects "all-time" status totals which match what admin
        // sees if they switch dropdown.
        const buckets = ["pending", "approved", "auto_approved", "rejected", "expired"];
        const responses = await Promise.all(
          buckets.map((s) =>
            fetch(`/api/requests?status=${s}&pageSize=1&sortBy=requested_at`)
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null),
          ),
        );
        if (cancelled) return;
        const next: Record<string, number> = {};
        buckets.forEach((s, i) => {
          const body = responses[i];
          const total = body?.data?.total;
          if (typeof total === "number") next[s] = total;
        });
        // also approximate "all" by summing the 5 buckets — close enough
        if (Object.keys(next).length > 0) {
          next.all = Object.values(next).reduce((a, b) => a + b, 0);
        }
        setStatusCounts(next);
      } catch {
        /* swallow — badge just disappears */
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeCount = useMemo(() => countActiveFilters(filters), [filters]);

  // ─── Handlers ─────────────────────────────────────────────────────
  function handleApprove(id: string) {
    setActiveRequestId(id);
    setApproveDialogOpen(true);
  }
  function handleReject(id: string) {
    setActiveRequestId(id);
    setRejectDialogOpen(true);
  }
  function handleView(id: string) {
    setActiveRequestId(id);
    setApproveDialogOpen(false);
    setRejectDialogOpen(false);
  }

  async function handleBatchReject() {
    // Wave 26-D bug hunt v2 [P0-1] — iterate ONLY pendingSelected
    // (the pre-filtered subset whose status === "pending"). Pre-fix
    // iterated selectedIds directly which could include approved /
    // rejected rows from a previous filter view.
    const targetIds = pendingSelected;
    if (targetIds.length === 0) {
      toast.error("Không có yêu cầu pending nào trong selection");
      return;
    }
    let successCount = 0;
    for (const id of targetIds) {
      try {
        const res = await fetch(`/api/requests/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "rejected" }),
        });
        if (res.ok) successCount++;
      } catch (err) {
        console.error(`Failed to reject request ${id}:`, err);
      }
    }
    if (successCount > 0) {
      toast.success(
        t("requests.batchRejectResult")
          .replace("{success}", String(successCount))
          .replace("{total}", String(targetIds.length)),
      );
    } else {
      toast.error("Không từ chối được yêu cầu nào");
    }
    setSelectedIds([]);
    void fetchRequests();
  }

  // Only PENDING requests are approvable / rejectable in bulk.
  const pendingSelected = selectedIds.filter((id) =>
    requests.find((r) => r.id === id && r.status === "pending"),
  );

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6">
      {/* Page Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t("requests.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("requests.subtitle")}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => fetchRequests()}
          disabled={isLoading}
          title="Tải lại"
          aria-label="Tải lại danh sách"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Filter row */}
      <RequestFilters
        filters={filters}
        onFiltersChange={setFilters}
        counts={statusCounts}
        countries={countries}
        activeCount={activeCount}
      />

      {/* Bulk actions bar — shared BulkActionBar shell. Only shows when
          admin has at least 1 PENDING row in selection (other statuses
          are not approvable / rejectable in bulk). Decoupled from the
          (now removed) tab guard so admin can bulk-act on any selection
          in any filter view. */}
      {canWrite && (
        <BulkActionBar
          selectedCount={pendingSelected.length}
          itemNoun="yêu cầu chờ xử lý"
          onClearSelection={() => setSelectedIds([])}
          actions={
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setBatchApproveOpen(true)}
              >
                <Zap className="mr-1 h-3.5 w-3.5" />
                {t("requests.batchApprove")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBatchReject}
              >
                <XCircle className="mr-1 h-3.5 w-3.5" />
                {t("requests.batchReject")}
              </Button>
            </>
          }
        />
      )}

      {/* Wave 27 UX-3 — adopt canonical EmptyState (was 2 inline divs).
          mode="filter-empty" auto-renders the "Xoá hết bộ lọc" CTA;
          mode="zero-data" uses the requests preset (no CTA — bot
          drives request creation, not the admin web). */}
      {!isLoading && requests.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-card">
          <EmptyState
            entity="requests"
            mode={activeCount > 0 ? "filter-empty" : "zero-data"}
            onClearFilters={
              activeCount > 0
                ? () => setFilters({ ...DEFAULT_REQUEST_FILTERS })
                : undefined
            }
          />
        </div>
      )}

      {/* Table — only renders when we have data OR loading */}
      {(isLoading || requests.length > 0) && (
        <>
          <RequestTable
            requests={requests}
            total={total}
            page={page}
            pageSize={pageSize}
            totalPages={totalPages}
            isLoading={isLoading}
            // Adapter — RequestTable expects RequestFiltersType (server shape),
            // not the page-local RequestPageFilters. We don't actually use
            // its filter callbacks for the new flow (RequestFilters
            // owns it), but keeping the prop wired prevents a regression
            // if RequestTable ever needs to read sort state.
            filters={
              {
                page,
                pageSize,
                sortBy: "requested_at",
                sortOrder: "desc",
              } satisfies RequestFiltersType
            }
            onFiltersChange={() => {
              /* no-op — filtering owned by RequestFilters above */
            }}
            onApprove={handleApprove}
            onReject={handleReject}
            onView={handleView}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
          />

          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            totalPages={totalPages}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </>
      )}

      {/* Dialogs */}
      <ApproveDialog
        open={approveDialogOpen}
        onOpenChange={setApproveDialogOpen}
        requestId={activeRequestId}
        onApproved={() => {
          void fetchRequests();
          setSelectedIds([]);
        }}
      />
      <RejectDialog
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        requestId={activeRequestId}
        onRejected={() => {
          void fetchRequests();
          setSelectedIds([]);
        }}
      />
      <BatchApproveDialog
        open={batchApproveOpen}
        onOpenChange={setBatchApproveOpen}
        requestIds={pendingSelected}
        onApproved={() => {
          void fetchRequests();
          setSelectedIds([]);
        }}
      />
    </div>
  );
}
