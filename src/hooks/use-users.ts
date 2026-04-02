"use client";

import { useState, useCallback, useEffect } from "react";
import type { TeleUser, TeleUserUpdate } from "@/types/database";
import type { UserFilters, PaginatedResponse, ApiResponse } from "@/types/api";

interface UseUsersReturn {
  users: TeleUser[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isLoading: boolean;
  error: string | null;
  filters: UserFilters;
  setFilters: (filters: UserFilters) => void;
  fetchUsers: () => Promise<void>;
  getUser: (id: string) => Promise<TeleUser | null>;
  updateUser: (id: string, data: TeleUserUpdate) => Promise<boolean>;
  deleteUser: (id: string) => Promise<boolean>;
  blockUser: (id: string) => Promise<boolean>;
  unblockUser: (id: string) => Promise<boolean>;
  createUser: (data: Partial<TeleUser>) => Promise<boolean>;
}

export function useUsers(initialFilters?: UserFilters): UseUsersReturn {
  const [users, setUsers] = useState<TeleUser[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<UserFilters>(
    initialFilters ?? { page: 1, pageSize: 20 }
  );

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          params.set(key, String(value));
        }
      });

      const res = await fetch(`/api/users?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch users");
      const json: ApiResponse<PaginatedResponse<TeleUser>> = await res.json();

      if (json.success && json.data) {
        setUsers(json.data.data);
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

  const getUser = useCallback(async (id: string): Promise<TeleUser | null> => {
    try {
      const res = await fetch(`/api/users/${id}`);
      if (!res.ok) return null;
      const json: ApiResponse<TeleUser> = await res.json();
      return json.success && json.data ? json.data : null;
    } catch {
      return null;
    }
  }, []);

  const updateUser = useCallback(async (id: string, data: TeleUserUpdate): Promise<boolean> => {
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const deleteUser = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const blockUser = useCallback(
    async (id: string) => updateUser(id, { status: "blocked" as never }),
    [updateUser]
  );

  const unblockUser = useCallback(
    async (id: string) => updateUser(id, { status: "active" as never }),
    [updateUser]
  );

  const createUser = useCallback(async (data: Partial<TeleUser>): Promise<boolean> => {
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  return {
    users,
    total,
    page: filters.page ?? 1,
    pageSize: filters.pageSize ?? 20,
    totalPages,
    isLoading,
    error,
    filters,
    setFilters,
    fetchUsers,
    getUser,
    updateUser,
    deleteUser,
    blockUser,
    unblockUser,
    createUser,
  };
}
