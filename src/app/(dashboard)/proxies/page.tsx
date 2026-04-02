"use client";

import { useEffect, useState, useCallback } from "react";
import { useRole } from "@/lib/role-context";
import { ProxyFilters } from "@/components/proxies/proxy-filters";
import { ProxyTable } from "@/components/proxies/proxy-table";
import { ProxyForm } from "@/components/proxies/proxy-form";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Upload,
  Download,
  Trash2,
  Activity,
  RefreshCw,
} from "lucide-react";
import { Pagination } from "@/components/shared/pagination";
import type { ProxyFilters as ProxyFiltersType } from "@/types/api";
import type { Proxy } from "@/types/database";
import Link from "next/link";

export default function ProxiesPage() {
  const { canWrite } = useRole();
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [countries, setCountries] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editProxy, setEditProxy] = useState<Proxy | null>(null);

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
      if (filters.tags) params.set("tags", filters.tags.join(","));
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

  useEffect(() => {
    fetchProxies();
  }, [fetchProxies]);

  useEffect(() => {
    fetchCountries();
  }, [fetchCountries]);

  function handleSort(column: string) {
    setFilters((prev) => ({
      ...prev,
      sortBy: column,
      sortOrder:
        prev.sortBy === column && prev.sortOrder === "asc" ? "desc" : "asc",
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

  async function handleBulkDelete() {
    for (const id of selectedIds) {
      await fetch(`/api/proxies/${id}`, { method: "DELETE" });
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

  function handleExport(format: "csv" | "json") {
    const dataToExport = proxies.map((p) => ({
      host: p.host,
      port: p.port,
      type: p.type,
      status: p.status,
      username: p.username || "",
      password: p.password || "",
      country: p.country || "",
      city: p.city || "",
      speed_ms: p.speed_ms ?? "",
      expires_at: p.expires_at || "",
    }));

    let content: string;
    let mimeType: string;
    let ext: string;

    if (format === "csv") {
      const headers = Object.keys(dataToExport[0] || {}).join(",");
      const rows = dataToExport.map((row) =>
        Object.values(row)
          .map((v) => `"${v}"`)
          .join(",")
      );
      content = [headers, ...rows].join("\n");
      mimeType = "text/csv";
      ext = "csv";
    } else {
      content = JSON.stringify(dataToExport, null, 2);
      mimeType = "application/json";
      ext = "json";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `proxies.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Proxies</h1>
          <p className="text-muted-foreground">
            Manage your proxy inventory ({total} total)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canWrite && (
            <Button variant="outline" size="sm" render={<Link href="/proxies/import" />}>
              <Upload className="size-4 mr-1.5" />
              Import
            </Button>
          )}
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
            <Button
              size="sm"
              onClick={() => {
                setEditProxy(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4 mr-1.5" />
              Add Proxy
            </Button>
          )}
        </div>
      </div>

      <ProxyFilters
        filters={filters}
        onFiltersChange={setFilters}
        countries={countries}
      />

      {/* Bulk actions */}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-2">
          <span className="text-sm text-muted-foreground">
            {selectedIds.length} selected
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleHealthCheck(selectedIds)}
          >
            <Activity className="size-4 mr-1" />
            Health Check
          </Button>
          {canWrite && (
            <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
              <Trash2 className="size-4 mr-1" />
              Delete
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedIds([])}
          >
            Clear
          </Button>
        </div>
      )}

      <div className="rounded-lg border border-border">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="size-5 animate-spin text-muted-foreground" />
          </div>
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
    </div>
  );
}
