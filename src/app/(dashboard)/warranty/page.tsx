"use client";

/**
 * Wave 26-D-2 — /warranty admin page.
 *
 * Single-table + powerful filter (mirror /requests page pattern).
 * Default open state: status=pending + within=7d (action queue).
 *
 * Bulk approve/reject NOT shipped — warranty is high-stakes (replacement
 * proxy gets allocated), each claim deserves an explicit ConfirmDialog
 * with the optional checkbox / reason. Adding bulk later if real
 * volume justifies.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldAlert, RefreshCw } from "lucide-react";
import { useRole } from "@/lib/role-context";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/shared/pagination";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useSharedQuery } from "@/lib/shared-cache";
import {
  WarrantyFilters,
  countActiveWarrantyFilters,
  DEFAULT_WARRANTY_FILTERS,
  type WarrantyPageFilters,
} from "@/components/warranty/warranty-filters";
import {
  parseWarrantyFiltersFromSearchParams,
  formatWarrantyFiltersToSearchParams,
  resolveWarrantyTimeBucket,
} from "@/components/warranty/warranty-filters-url";
import {
  WarrantyTable,
  type WarrantyClaimRow,
} from "@/components/warranty/warranty-table";
import {
  ApproveWarrantyDialog,
  RejectWarrantyDialog,
} from "@/components/warranty/warranty-dialogs";
import type { ApiResponse, PaginatedResponse } from "@/types/api";

const PAGE_SIZE = 20;

interface AdminLite {
  id: string;
  email: string;
  full_name: string | null;
}

export default function WarrantyPage() {
  const { canWrite } = useRole();
  const router = useRouter();
  const searchParams = useSearchParams();

  // ─── Filter state (URL-bound) ──────────────────────────────────
  const [filters, setFilters] = useState<WarrantyPageFilters>(() =>
    parseWarrantyFiltersFromSearchParams(
      new URLSearchParams(searchParams.toString()),
    ),
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  useEffect(() => {
    const params = formatWarrantyFiltersToSearchParams(filters);
    const url = params.toString()
      ? `/warranty?${params.toString()}`
      : "/warranty";
    router.replace(url, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  useEffect(() => {
    setPage(1);
  }, [filters]);

  // ─── Data state ────────────────────────────────────────────────
  const [claims, setClaims] = useState<WarrantyClaimRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  // Dialogs
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [activeClaim, setActiveClaim] = useState<WarrantyClaimRow | null>(null);

  // Admin list — for the "Admin xử lý" filter dropdown.
  const { data: admins = [] } = useSharedQuery<AdminLite[]>(
    "api:admins:lite",
    async () => {
      const r = await fetch("/api/admins?pageSize=200");
      if (!r.ok) return [];
      const body = await r.json();
      const list: AdminLite[] = Array.isArray(body?.data?.data)
        ? body.data.data
        : Array.isArray(body?.data)
          ? body.data
          : [];
      return list.map((a) => ({
        id: a.id,
        email: a.email,
        full_name: a.full_name ?? null,
      }));
    },
  );

  const adminOptions = useMemo(
    () =>
      admins.map((a) => ({
        id: a.id,
        label: a.full_name ?? a.email,
      })),
    [admins],
  );

  // ─── Fetch claims for current filter ───────────────────────────
  const fetchClaims = useCallback(async () => {
    setIsLoading(true);
    try {
      const apiParams = new URLSearchParams();
      if (filters.status !== "all") apiParams.set("status", filters.status);
      const range = resolveWarrantyTimeBucket(filters);
      if (range.dateFrom) apiParams.set("dateFrom", range.dateFrom);
      if (range.dateTo) apiParams.set("dateTo", range.dateTo);
      if (filters.reasonCode !== "all")
        apiParams.set("reasonCode", filters.reasonCode);
      if (filters.hasReplacement === "yes") apiParams.set("hasReplacement", "true");
      if (filters.hasReplacement === "no") apiParams.set("hasReplacement", "false");
      if (filters.resolvedBy !== "all")
        apiParams.set("resolvedBy", filters.resolvedBy);
      if (filters.search) apiParams.set("search", filters.search);
      apiParams.set("page", String(page));
      apiParams.set("pageSize", String(pageSize));

      const res = await fetch(`/api/warranty?${apiParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch warranty claims");
      const json: ApiResponse<PaginatedResponse<WarrantyClaimRow>> = await res.json();
      if (json.success && json.data) {
        setClaims(json.data.data);
        setTotal(json.data.total);
        setTotalPages(json.data.totalPages);
      }
    } catch (err) {
      console.error("Failed to load warranty:", err);
      toast.error("Không tải được danh sách bảo hành");
    } finally {
      setIsLoading(false);
    }
  }, [filters, page, pageSize]);

  useEffect(() => {
    void fetchClaims();
  }, [fetchClaims]);

  // ─── Realtime: re-fetch on warranty_claims changes ─────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fetchRef = useRef(fetchClaims);
  fetchRef.current = fetchClaims;
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("warranty-changes")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "warranty_claims" }, () => {
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

  // ─── Per-status counts (badge) ─────────────────────────────────
  //
  // Wave 26-D bug hunt v4 [MEDIUM] — decouple from `claims`.
  //
  // Pre-fix: `[claims]` as dep meant every realtime update on
  // warranty_claims fired:
  //   1. fetchClaims() (1 HTTP request)
  //   2. -> setClaims() bumps the array
  //   3. -> this effect fires
  //   4. -> 3 parallel HTTP requests for status counts
  // = 4 HTTP requests per single DB write. Under moderate admin
  // activity this fanned out continuously and turned the page into
  // a request-spam machine. The /requests page already does it right
  // (deps = []) — load once on mount, accept eventual staleness for
  // the badge counts.
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const buckets = ["pending", "approved", "rejected"];
        const responses = await Promise.all(
          buckets.map((s) =>
            fetch(`/api/warranty?status=${s}&pageSize=1`)
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null),
          ),
        );
        if (cancelled) return;
        const next: Record<string, number> = {};
        buckets.forEach((s, i) => {
          const total = responses[i]?.data?.total;
          if (typeof total === "number") next[s] = total;
        });
        if (Object.keys(next).length > 0) {
          next.all = Object.values(next).reduce((a, b) => a + b, 0);
        }
        setStatusCounts(next);
      } catch {
        /* swallow */
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wave 26-D bug hunt v4 [MEDIUM] — clear dialog state on filter
  // change. Pre-fix if admin opened the approve dialog and then
  // changed the filter tab (e.g., Pending → All), `activeClaim`
  // held a stale row from the previous list. The dialog stayed
  // open with possibly-out-of-scope data.
  useEffect(() => {
    setActiveClaim(null);
    setApproveOpen(false);
    setRejectOpen(false);
  }, [filters]);

  const activeCount = useMemo(() => countActiveWarrantyFilters(filters), [filters]);

  // ─── Render ───────────────────────────────────────────────────
  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
            <ShieldAlert className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Bảo hành proxy</h1>
            <p className="text-sm text-muted-foreground">
              User báo lỗi proxy qua bot — admin xử lý ở đây.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => fetchClaims()}
          disabled={isLoading}
          aria-label="Tải lại"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <WarrantyFilters
        filters={filters}
        onFiltersChange={setFilters}
        counts={statusCounts}
        admins={adminOptions}
        activeCount={activeCount}
      />

      {/* Empty states */}
      {!isLoading && claims.length === 0 && activeCount > 0 && (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm font-medium">Không có claim nào khớp bộ lọc</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Thử bỏ bớt tiêu chí, hoặc đổi sang khoảng thời gian rộng hơn.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => setFilters({ ...DEFAULT_WARRANTY_FILTERS })}
          >
            Xoá hết bộ lọc
          </Button>
        </div>
      )}

      {!isLoading && claims.length === 0 && activeCount === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm font-medium">Chưa có claim bảo hành nào</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Claim sẽ xuất hiện ở đây khi user báo lỗi proxy qua bot.
          </p>
        </div>
      )}

      {(isLoading || claims.length > 0) && (
        <>
          <WarrantyTable
            claims={claims}
            isLoading={isLoading}
            canWrite={canWrite}
            onApprove={(c) => {
              setActiveClaim(c);
              setApproveOpen(true);
            }}
            onReject={(c) => {
              setActiveClaim(c);
              setRejectOpen(true);
            }}
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

      <ApproveWarrantyDialog
        open={approveOpen}
        // Wave 26-D bug hunt [MED, code-reviewer P1-4] — clear
        // activeClaim when dialog closes so the next click on a
        // different row in the table doesn't see stale data.
        // Pre-fix: open A → close → realtime updates list → click B →
        // dialog briefly shows A's reason_text before re-render.
        onOpenChange={(open) => {
          setApproveOpen(open);
          if (!open) setActiveClaim(null);
        }}
        claim={activeClaim}
        onApproved={() => {
          void fetchClaims();
          setActiveClaim(null);
        }}
      />
      <RejectWarrantyDialog
        open={rejectOpen}
        onOpenChange={(open) => {
          setRejectOpen(open);
          if (!open) setActiveClaim(null);
        }}
        claim={activeClaim}
        onRejected={() => {
          void fetchClaims();
          setActiveClaim(null);
        }}
      />
    </div>
  );
}
