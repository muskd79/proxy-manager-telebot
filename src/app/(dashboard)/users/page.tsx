"use client";

import { useState, useEffect, useRef } from "react";
import {
  Users,
  Search,
  Download,
  Ban,
  CheckCircle,
  Trash2,
  Filter,
} from "lucide-react";
import { useRole } from "@/lib/role-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { UserTable } from "@/components/users/user-table";
import { Pagination } from "@/components/shared/pagination";
import { useUsers } from "@/hooks/use-users";
import type { TeleUserStatus } from "@/types/database";
import { createClient } from "@/lib/supabase/client";

export default function UsersPage() {
  const { t } = useI18n();
  const { canWrite } = useRole();
  const {
    users,
    total,
    page,
    pageSize,
    totalPages,
    isLoading,
    filters,
    setFilters,
    fetchUsers,
    blockUser,
    unblockUser,
    deleteUser,
  } = useUsers();

  // Realtime sync: re-fetch when tele_users table changes (debounced to reduce load)
  const usersDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("users-changes")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "tele_users" }, () => {
        clearTimeout(usersDebounceRef.current);
        usersDebounceRef.current = setTimeout(() => {
          fetchUsers();
        }, 2000);
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.error('Realtime subscription error on users channel');
        }
      });

    return () => {
      clearTimeout(usersDebounceRef.current);
      channel.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [fetchUsers]);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<"block" | "unblock" | "delete" | null>(null);
  const [searchValue, setSearchValue] = useState("");

  const handleSearch = () => {
    setFilters({ ...filters, search: searchValue, page: 1 });
  };

  const handleStatusFilter = (value: string) => {
    setFilters({
      ...filters,
      status: value === "all" ? undefined : (value as TeleUserStatus),
      page: 1,
    });
  };

  const handleBulkAction = async () => {
    if (!bulkAction || selectedIds.length === 0) return;

    let successCount = 0;
    for (const id of selectedIds) {
      let success = false;
      switch (bulkAction) {
        case "block":
          success = await blockUser(id);
          break;
        case "unblock":
          success = await unblockUser(id);
          break;
        case "delete":
          success = await deleteUser(id);
          break;
      }
      if (success) successCount++;
    }

    toast.success(`${bulkAction} completed for ${successCount}/${selectedIds.length} users`);
    setSelectedIds([]);
    setBulkAction(null);
    fetchUsers();
  };

  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          params.set(key, String(value));
        }
      });
      params.set("pageSize", "10000");
      params.set("page", "1");

      const res = await fetch(`/api/users?${params.toString()}`);
      if (!res.ok) throw new Error("Export failed");
      const json = await res.json();

      if (!json.success || !json.data?.data) throw new Error("No data");

      const csvRows = [
        ["telegram_id", "username", "first_name", "last_name", "status", "approval_mode", "max_proxies", "created_at"].join(","),
        ...json.data.data.map((u: Record<string, unknown>) =>
          [u.telegram_id, u.username || "", u.first_name || "", u.last_name || "", u.status, u.approval_mode, u.max_proxies, u.created_at].join(",")
        ),
      ];

      const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `users-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("users.exportSuccess"));
    } catch (err) {
      console.error("Failed to export users:", err);
      toast.error(t("users.exportFailed"));
    }
  };

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t("users.telegramUsers")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("users.subtitle")}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={handleExport}>
          <Download className="mr-2 h-4 w-4" />
          {t("common.export")}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("users.searchPlaceholder")}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="bg-background pl-10"
          />
        </div>
        <Select
          value={filters.status || "all"}
          onValueChange={(v) => handleStatusFilter(v ?? '')}
        >
          <SelectTrigger className="w-[160px] bg-background">
            <Filter className="mr-2 h-4 w-4" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("users.allStatus")}</SelectItem>
            <SelectItem value="active">{t("users.active")}</SelectItem>
            <SelectItem value="blocked">{t("users.blocked")}</SelectItem>
            <SelectItem value="pending">{t("users.pending")}</SelectItem>
            <SelectItem value="banned">{t("users.banned")}</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={handleSearch}>{t("common.search")}</Button>
      </div>

      {/* Bulk Actions */}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-3">
          <span className="text-sm font-medium">
            {t("users.usersSelected").replace("{count}", String(selectedIds.length))}
          </span>
          {canWrite && (
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkAction("block")}
              >
                <Ban className="mr-1 h-3.5 w-3.5" />
                {t("users.blockUser")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkAction("unblock")}
              >
                <CheckCircle className="mr-1 h-3.5 w-3.5" />
                {t("users.unblockUser")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setBulkAction("delete")}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                {t("common.delete")}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* User Table */}
      <UserTable
        users={users}
        total={total}
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        isLoading={isLoading}
        filters={filters}
        onFiltersChange={setFilters}
        onBlock={blockUser}
        onUnblock={unblockUser}
        onDelete={deleteUser}
        onRefresh={fetchUsers}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />

      {/* Pagination */}
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        totalPages={totalPages}
        onPageChange={(p) => setFilters({ ...filters, page: p })}
        onPageSizeChange={(size) => setFilters({ ...filters, pageSize: size, page: 1 })}
      />

      {/* Bulk Action Confirmation */}
      <AlertDialog
        open={bulkAction !== null}
        onOpenChange={(open) => !open && setBulkAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkAction === "block"
                ? t("users.blockUsers")
                : bulkAction === "unblock"
                  ? t("users.unblockUsers")
                  : t("users.deleteUsers")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("users.bulkConfirm").replace("{action}", bulkAction ?? "").replace("{count}", String(selectedIds.length))}
              {bulkAction === "delete" && ` ${t("users.softDeleteNote")}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkAction}
              className={
                bulkAction === "delete"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : ""
              }
            >
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
