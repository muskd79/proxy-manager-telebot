"use client";

import { useEffect, useState, useCallback, use } from "react";
import { ProxyDetail } from "@/components/proxies/proxy-detail";
import { ProxyForm } from "@/components/proxies/proxy-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { ArrowLeft, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Proxy, ProxyRequest } from "@/types/database";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

export default function ProxyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [proxy, setProxy] = useState<Proxy | null>(null);
  const [history, setHistory] = useState<ProxyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  // Wave 22X — confirm before single-proxy delete (HIGH #17 from review)
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchProxy = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/proxies/${id}`);
      if (res.ok) {
        const result = await res.json();
        setProxy(result.data);
      }
    } catch (err) {
      console.error("Failed to fetch proxy details:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/requests?proxyId=${id}&pageSize=50&sortBy=created_at&sortOrder=desc`
      );
      if (res.ok) {
        const result = await res.json();
        // Wave 22W BUG FIX: /api/requests returns ApiResponse<PaginatedResponse<T>>
        // so result.data is the wrapper { data, total, page, pageSize, totalPages },
        // NOT the array directly. Pre-fix passed the wrapper into history state and
        // ProxyDetail's `assignmentHistory.map(...)` crashed with
        // "j.map is not a function" — exactly what user hit on /proxies/[id].
        const list = Array.isArray(result?.data)
          ? result.data
          : Array.isArray(result?.data?.data)
            ? result.data.data
            : [];
        setHistory(list);
      }
    } catch (err) {
      console.error("Failed to fetch proxy history:", err);
    }
  }, [id]);

  useEffect(() => {
    fetchProxy();
    fetchHistory();
  }, [fetchProxy, fetchHistory]);

  async function handleSave(data: Record<string, unknown>) {
    const res = await fetch(`/api/proxies/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to update");
    fetchProxy();
  }

  // Wave 22X — confirm-then-delete + toast feedback. Pre-fix: 1 click
  // soft-deleted the proxy with NO confirm and NO toast.
  function requestDelete() {
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/proxies/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Đã chuyển proxy vào thùng rác");
        router.push("/proxies");
      } else {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "Xoá proxy thất bại");
      }
    } catch (err) {
      console.error("Failed to delete proxy:", err);
      toast.error("Xoá proxy thất bại");
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  async function handleHealthCheck() {
    await fetch("/api/proxies/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    });
    fetchProxy();
  }

  if (loading) {
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
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Link href="/proxies" className={buttonVariants({ variant: "ghost", size: "icon" })}>
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Chi tiết proxy</h1>
          <p className="text-muted-foreground font-mono">
            {proxy.host}:{proxy.port}
          </p>
        </div>
      </div>

      <ProxyDetail
        proxy={proxy}
        assignmentHistory={history}
        onEdit={() => setFormOpen(true)}
        onDelete={requestDelete}
        onHealthCheck={handleHealthCheck}
      />

      <ProxyForm
        open={formOpen}
        onOpenChange={setFormOpen}
        proxy={proxy}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        variant="destructive"
        title="Xoá proxy này?"
        description={`${proxy.host}:${proxy.port} sẽ được chuyển vào Thùng rác. Bạn có 30 ngày để khôi phục trước khi hệ thống xoá vĩnh viễn.`}
        confirmText="Xoá"
        cancelText="Huỷ"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
