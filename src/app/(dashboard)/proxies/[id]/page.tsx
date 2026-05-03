"use client";

/**
 * Wave 26-D-pre1 — proxy detail page rebuild around the storyteller layout.
 *
 * Pre-fix the page rendered the 288-line monolith ProxyDetail with a
 * single Assignment History table fetched from /api/requests. Now:
 *
 *   - Fetches the proxy itself (`/api/proxies/[id]`)
 *   - Fetches assignment requests (`/api/requests?proxyId=…`)
 *   - Fetches activity logs scoped to this proxy
 *     (`/api/logs?resourceType=proxy&resourceId=…`)
 *   - Fetches the proxy's category name (single call from
 *     /api/categories — cached via useSharedQuery)
 *   - Synthesises a single-element health probe array from
 *     proxy.last_checked_at + proxy.speed_ms (Wave 26-D ships
 *     proxy_health_logs with 20 probes; pre1 falls back gracefully)
 *   - Merges + sorts events into the timeline
 *   - Hands everything off to <ProxyDetail /> (the new composer)
 *
 * Health-check trigger: the QuickActions "Kiểm tra ngay" button calls
 * /api/proxies/check + refetches both the proxy AND the timeline so a
 * new probe + a new activity log row appear immediately.
 */

import { useEffect, useState, useCallback, useMemo, use } from "react";
import { ProxyDetail, type TimelineEvent, type ProxyHealthProbe } from "@/components/proxies/detail";
import { ProxyForm } from "@/components/proxies/proxy-form";
import { buttonVariants } from "@/components/ui/button";
import { ArrowLeft, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Proxy, ProxyRequest, ActivityLog } from "@/types/database";
import { useRole } from "@/lib/role-context";
import { useSharedQuery } from "@/lib/shared-cache";
import {
  mapRequestsToEvents,
  mapActivityLogsToEvents,
  mergeAndSortEvents,
} from "@/components/proxies/detail/event-mappers";

interface CategoryLite {
  id: string;
  name: string;
}

export default function ProxyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { canWrite } = useRole();

  const [proxy, setProxy] = useState<Proxy | null>(null);
  const [requests, setRequests] = useState<ProxyRequest[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loadingProxy, setLoadingProxy] = useState(true);
  const [loadingTimeline, setLoadingTimeline] = useState(true);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  // ─── Fetchers ──────────────────────────────────────────────────────

  const fetchProxy = useCallback(async () => {
    setLoadingProxy(true);
    try {
      const res = await fetch(`/api/proxies/${id}`);
      if (res.ok) {
        const result = await res.json();
        setProxy(result.data ?? null);
      } else if (res.status === 404) {
        setProxy(null);
      }
    } catch (err) {
      console.error("Failed to fetch proxy:", err);
    } finally {
      setLoadingProxy(false);
    }
  }, [id]);

  const fetchTimeline = useCallback(async () => {
    setLoadingTimeline(true);
    setTimelineError(null);
    try {
      // Parallel fetch for /api/requests and /api/logs.
      const [reqRes, logRes] = await Promise.all([
        fetch(
          `/api/requests?proxyId=${id}&pageSize=100&sortBy=created_at&sortOrder=desc`,
        ),
        fetch(
          `/api/logs?resourceType=proxy&resourceId=${id}&pageSize=100&sortBy=created_at&sortOrder=desc`,
        ),
      ]);

      // /api/requests returns ApiResponse<PaginatedResponse<T>>
      // (Wave 22W bug pin) so .data is the wrapper.
      let requestList: ProxyRequest[] = [];
      if (reqRes.ok) {
        const body = await reqRes.json().catch(() => null);
        requestList = Array.isArray(body?.data)
          ? body.data
          : Array.isArray(body?.data?.data)
            ? body.data.data
            : [];
      }

      let logList: ActivityLog[] = [];
      if (logRes.ok) {
        const body = await logRes.json().catch(() => null);
        logList = Array.isArray(body?.data)
          ? body.data
          : Array.isArray(body?.data?.data)
            ? body.data.data
            : [];
      }

      setRequests(requestList);
      setLogs(logList);
    } catch (err) {
      console.error("Failed to fetch timeline:", err);
      setTimelineError("Không tải được lịch sử hoạt động — thử tải lại trang.");
    } finally {
      setLoadingTimeline(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchProxy();
    void fetchTimeline();
  }, [fetchProxy, fetchTimeline]);

  // Category list — reuse Wave 26-C shared cache key. We only need the
  // single matching category so we derive in-component.
  const { data: categories = [] } = useSharedQuery<CategoryLite[]>(
    "api:categories:full",
    async () => {
      const r = await fetch("/api/categories");
      if (!r.ok) return [];
      const result = await r.json();
      return Array.isArray(result?.data) ? result.data : [];
    },
  );
  const categoryName = useMemo(() => {
    if (!proxy?.category_id) return null;
    return categories.find((c) => c.id === proxy.category_id)?.name ?? null;
  }, [proxy?.category_id, categories]);

  // ─── Timeline events (memo over upstream fetches) ──────────────────
  const timelineEvents: TimelineEvent[] = useMemo(() => {
    return mergeAndSortEvents(
      mapRequestsToEvents(requests),
      mapActivityLogsToEvents(logs),
    );
  }, [requests, logs]);

  // Health probes — pre1 only synthesises a single point from
  // proxy.last_checked_at + proxy.speed_ms. When proxy_health_logs
  // ships in Wave 26-D, replace this with a fetch to that table.
  const healthProbes: ProxyHealthProbe[] = useMemo(() => {
    if (!proxy?.last_checked_at) return [];
    return [
      {
        checked_at: proxy.last_checked_at,
        ok: proxy.speed_ms != null,
        speed_ms: proxy.speed_ms,
        error_msg: proxy.speed_ms == null ? "Không phản hồi" : null,
      },
    ];
  }, [proxy?.last_checked_at, proxy?.speed_ms]);

  // ─── Action callbacks ──────────────────────────────────────────────

  async function handleSave(data: Record<string, unknown>) {
    const res = await fetch(`/api/proxies/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to update");
    await Promise.all([fetchProxy(), fetchTimeline()]);
  }

  async function handleHealthCheck() {
    const res = await fetch("/api/proxies/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    });
    if (!res.ok) throw new Error("Health check failed");
    // Refetch — show new last_checked_at + speed_ms in the strip,
    // and any activity_log row the check itself emits.
    await Promise.all([fetchProxy(), fetchTimeline()]);
  }

  async function handleToggleHidden(next: boolean) {
    const res = await fetch(`/api/proxies/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: next }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Toggle hidden failed");
    }
    await Promise.all([fetchProxy(), fetchTimeline()]);
  }

  async function handleSoftDelete() {
    const res = await fetch(`/api/proxies/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Đã chuyển proxy vào thùng rác");
      router.push("/proxies");
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error || "Xoá proxy thất bại");
      throw new Error("Soft delete failed");
    }
  }

  async function handleSetStatus(
    next: Proxy["status"],
    reason: string | null,
  ) {
    const res = await fetch(`/api/proxies/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: next,
        // Wave 26-D-pre1 — log reason via notes field for now. Wave 26-D
        // adds proxy_events.details.reason as the canonical home, plus
        // an explicit `change_reason` body field on the PATCH route.
        ...(reason ? { notes: appendReason(proxy?.notes, reason, next) } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Cập nhật trạng thái thất bại");
    }
    await Promise.all([fetchProxy(), fetchTimeline()]);
  }

  async function handleUnassign(reason: string | null) {
    const res = await fetch(`/api/proxies/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assigned_to: null,
        status: "available",
        ...(reason ? { notes: appendReason(proxy?.notes, reason, "unassign") } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Thu hồi proxy thất bại");
    }
    await Promise.all([fetchProxy(), fetchTimeline()]);
  }

  async function handleRestoreFromTrash() {
    const res = await fetch(`/api/proxies/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_deleted: false }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Khôi phục thất bại");
    }
    await Promise.all([fetchProxy(), fetchTimeline()]);
  }

  // ─── Render ────────────────────────────────────────────────────────

  if (loadingProxy && !proxy) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <RefreshCw className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!proxy) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-muted-foreground">Không tìm thấy proxy</p>
        <Link href="/proxies" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft className="size-4 mr-1.5" />
          Quay lại danh sách
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 p-4 sm:space-y-6 sm:p-6">
      {/* Page header — back-link + page title. The proxy host:port now
          lives inside the new ProxyDetailHeader (large), so we keep this
          row compact. */}
      <div className="flex items-center gap-3">
        <Link
          href="/proxies"
          className={buttonVariants({ variant: "ghost", size: "icon" })}
          aria-label="Quay lại danh sách proxy"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Chi tiết proxy</h1>
          <p className="text-xs text-muted-foreground">
            Mọi thông tin và lịch sử của proxy này.
          </p>
        </div>
      </div>

      <ProxyDetail
        proxy={proxy}
        canWrite={canWrite}
        timelineEvents={timelineEvents}
        timelineLoading={loadingTimeline}
        timelineError={timelineError}
        healthProbes={healthProbes}
        categoryName={categoryName}
        onEdit={() => setFormOpen(true)}
        onHealthCheck={handleHealthCheck}
        onToggleHidden={handleToggleHidden}
        onSoftDelete={handleSoftDelete}
        onSetStatus={handleSetStatus}
        onUnassign={handleUnassign}
        onRestoreFromTrash={handleRestoreFromTrash}
      />

      <ProxyForm
        open={formOpen}
        onOpenChange={setFormOpen}
        proxy={proxy}
        onSave={handleSave}
      />
    </div>
  );
}

/**
 * Wave 26-D-pre1 — placeholder: append a structured reason line to
 * proxy.notes so the audit trail is preserved until proxy_events lands.
 *
 * Format: `[YYYY-MM-DD HH:mm] {action}: {reason}` prepended to notes.
 *
 * Wave 26-D will write reasons into `proxy_events.details.reason`
 * directly, and this helper will be deleted (notes go back to being
 * pure admin-authored content).
 */
function appendReason(
  existing: string | null | undefined,
  reason: string,
  action: string,
): string {
  const now = new Date().toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const line = `[${now}] ${action}: ${reason}`;
  return existing ? `${line}\n${existing}` : line;
}
