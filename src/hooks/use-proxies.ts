"use client";

import { useState, useCallback, useEffect } from "react";
import type { Proxy, ProxyUpdate } from "@/types/database";
import type { ProxyFilters, PaginatedResponse, ApiResponse } from "@/types/api";

interface UseProxiesReturn {
  proxies: Proxy[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isLoading: boolean;
  error: string | null;
  filters: ProxyFilters;
  setFilters: (filters: ProxyFilters) => void;
  fetchProxies: () => Promise<void>;
  getProxy: (id: string) => Promise<Proxy | null>;
  createProxy: (data: Partial<Proxy>) => Promise<boolean>;
  updateProxy: (id: string, data: ProxyUpdate) => Promise<boolean>;
  deleteProxy: (id: string) => Promise<boolean>;
}

export function useProxies(initialFilters?: ProxyFilters): UseProxiesReturn {
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ProxyFilters>(
    initialFilters ?? { page: 1, pageSize: 20 }
  );

  const fetchProxies = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          if (Array.isArray(value)) {
            params.set(key, value.join(","));
          } else {
            params.set(key, String(value));
          }
        }
      });

      const res = await fetch(`/api/proxies?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch proxies");
      const json: ApiResponse<PaginatedResponse<Proxy>> = await res.json();

      if (json.success && json.data) {
        setProxies(json.data.data);
        setTotal(json.data.total);
        setTotalPages(json.data.totalPages);
      } else {
        throw new Error(json.error || "Unknown error");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  const getProxy = useCallback(async (id: string): Promise<Proxy | null> => {
    try {
      const res = await fetch(`/api/proxies/${id}`);
      if (!res.ok) return null;
      const json: ApiResponse<Proxy> = await res.json();
      return json.success && json.data ? json.data : null;
    } catch {
      return null;
    }
  }, []);

  const createProxy = useCallback(async (data: Partial<Proxy>): Promise<boolean> => {
    try {
      const res = await fetch("/api/proxies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const updateProxy = useCallback(async (id: string, data: ProxyUpdate): Promise<boolean> => {
    try {
      const res = await fetch(`/api/proxies/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const deleteProxy = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/proxies/${id}`, { method: "DELETE" });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    fetchProxies();
  }, [fetchProxies]);

  return {
    proxies,
    total,
    page: filters.page ?? 1,
    pageSize: filters.pageSize ?? 20,
    totalPages,
    isLoading,
    error,
    filters,
    setFilters,
    fetchProxies,
    getProxy,
    createProxy,
    updateProxy,
    deleteProxy,
  };
}
