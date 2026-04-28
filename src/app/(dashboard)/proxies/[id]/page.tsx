"use client";

import { useEffect, useState, useCallback, use } from "react";
import { ProxyDetail } from "@/components/proxies/proxy-detail";
import { ProxyForm } from "@/components/proxies/proxy-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { ArrowLeft, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Proxy, ProxyRequest } from "@/types/database";

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

  async function handleDelete() {
    const res = await fetch(`/api/proxies/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/proxies");
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
        <p className="text-muted-foreground">Proxy not found</p>
        <Link href="/proxies" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft className="size-4 mr-1.5" />
          Back to Proxies
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
          <h1 className="text-2xl font-bold tracking-tight">Proxy Details</h1>
          <p className="text-muted-foreground font-mono">
            {proxy.host}:{proxy.port}
          </p>
        </div>
      </div>

      <ProxyDetail
        proxy={proxy}
        assignmentHistory={history}
        onEdit={() => setFormOpen(true)}
        onDelete={handleDelete}
        onHealthCheck={handleHealthCheck}
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
