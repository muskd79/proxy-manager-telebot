"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  Users,
  Search,
  Download,
  Ban,
  CheckCircle,
  Trash2,
  Filter,
  RefreshCw,
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
// Wave 27 a11y/mobile [P0-3] — replaced raw AlertDialog with the
// upgraded ConfirmDialog (loading-pinned, destructive variant,
// VI-default labels, escape/backdrop swallow during work).
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { UserTable } from "@/components/users/user-table";
import { UserSubTabs } from "@/components/users/user-sub-tabs";
import { Pagination } from "@/components/shared/pagination";
// Wave 27 UX-4 — adopt shared BulkActionBar shell.
import { BulkActionBar } from "@/components/shared/bulk-action-bar";
import { useUsers } from "@/hooks/use-users";
import type { TeleUserStatus } from "@/types/database";
import { createClient } from "@/lib/supabase/client";
import { buildCsv } from "@/lib/csv";

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

  // Phase 3 (PM UX) — read ?status= from URL on mount so dashboard
  // KPI drill-down lands on a pre-filtered view. Pre-fix admin had
  // to click the card AND re-filter by hand. We sync the filter
  // back into setFilters so the rest of the page logic stays
  // unchanged.
  const searchParams = useSearchParams();
  useEffect(() => {
    const urlStatus = searchParams.get("status");
    if (urlStatus && urlStatus !== filters.status) {
      setFilters({
        ...filters,
        status: urlStatus as TeleUserStatus,
        page: 1,
      });
    }
    // intentionally only on first mount — don't react to filter
    // changes from inside the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime sync: re-fetch when tele_users table changes (debounced to reduce load)
  const usersDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("users-changes")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase JS realtime API does not export the literal union type for the event name
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
  // Wave 27 a11y/mobile [P0-3 / P1-4] — bulk-action progress counter +
  // pinned-busy state for the upgraded ConfirmDialog.
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkBusy, setBulkBusy] = useState(false);

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

    // Phase 3 (PM UX) — port Promise.allSettled pattern from /proxies
    // (Wave 22X). Pre-fix the for-loop ran serially, so blocking 100
    // users took 100 seconds AND the toast "block completed for
    // 87/100" hid which 13 failed and why. New pattern:
    //   - parallel fan-out
    //   - per-promise progress counter (Wave 27 a11y P1-4)
    //   - count successes and surface the first error
    //   - distinguish total / success / failed in toast
    const action = bulkAction;
    const total = selectedIds.length;

    setBulkBusy(true);
    setBulkProgress(0);

    const results = await Promise.allSettled(
      selectedIds.map(async (id) => {
        try {
          let ok = false;
          switch (action) {
            case "block":
              ok = (await blockUser(id)) ?? false;
              break;
            case "unblock":
              ok = (await unblockUser(id)) ?? false;
              break;
            case "delete":
              ok = (await deleteUser(id)) ?? false;
              break;
          }
          return ok;
        } finally {
          setBulkProgress((p) => p + 1);
        }
      }),
    );
    const successCount = results.filter(
      (r) => r.status === "fulfilled" && r.value === true,
    ).length;
    const failedCount = total - successCount;

    const labelVi: Record<string, string> = {
      block: "Chặn",
      unblock: "Bỏ chặn",
      delete: "Xoá",
    };
    const label = labelVi[action] ?? action;
    if (failedCount === 0) {
      toast.success(`${label}: ${successCount}/${total} thành công`);
    } else {
      toast.warning(
        `${label}: ${successCount}/${total} thành công, ${failedCount} thất bại`,
      );
    }
    setSelectedIds([]);
    setBulkAction(null);
    setBulkBusy(false);
    setBulkProgress(0);
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
      // Capped at 500 to avoid unbounded memory/DB load during export.
      params.set("pageSize", "500");
      params.set("page", "1");

      const res = await fetch(`/api/users?${params.toString()}`);
      if (!res.ok) throw new Error("Export failed");
      const json = await res.json();

      if (!json.success || !json.data?.data) throw new Error("No data");

      // Wave 22D-6 SECURITY FIX: pre-22D-6 did `row.join(",")` with
      // ZERO quoting and ZERO formula-injection escape. A username
      // like `=cmd|"/c calc"!A1` would EXECUTE in Excel on download.
      // A username with a comma silently corrupted every column
      // alignment downstream. Now: buildCsv handles both via the
      // sanitiser in lib/csv.ts.
      const csv = buildCsv<Record<string, unknown>>(json.data.data, [
        { header: "telegram_id", value: (u) => (u.telegram_id as number | string) ?? "" },
        { header: "username", value: (u) => (u.username as string) ?? "" },
        { header: "first_name", value: (u) => (u.first_name as string) ?? "" },
        { header: "last_name", value: (u) => (u.last_name as string) ?? "" },
        { header: "status", value: (u) => (u.status as string) ?? "" },
        { header: "approval_mode", value: (u) => (u.approval_mode as string) ?? "" },
        { header: "max_proxies", value: (u) => (u.max_proxies as number) ?? 0 },
        { header: "created_at", value: (u) => (u.created_at as string) ?? "" },
      ]);

      const blob = new Blob([csv], { type: "text/csv" });
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
      {/* Wave 22U — sub-tab of Người dùng Bot. */}
      <UserSubTabs />
      {/*
        Page Header
        Wave 27 a11y/mobile [P0-2] — flex-wrap so right-side action
        buttons don't clip off-screen at 375px. shrink-0 on the action
        group so the title's 2-line subtitle can compress instead of
        the buttons.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{t("users.telegramUsers")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("users.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            onClick={() => fetchUsers()}
            disabled={isLoading}
            title="Tải lại"
            aria-label="Tải lại danh sách user"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="outline" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            {t("common.export")}
          </Button>
        </div>
      </div>

      {/*
        Filters
        Wave 27 a11y/mobile [P0-1] — Status select w-full sm:w-[160px]
        so it stretches with siblings on mobile. Search button stays
        in the input row at sm: but stacks under the select on
        narrow phones (no awkward orphan button on its own line).
      */}
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
          <SelectTrigger className="w-full bg-background sm:w-[160px]">
            <Filter className="mr-2 h-4 w-4" />
            {/* Wave 22AA — labels map so trigger shows VI label, not raw value */}
            <SelectValue
              placeholder="Status"
              labels={{
                all: t("users.allStatus"),
                active: t("users.active"),
                blocked: t("users.blocked"),
                pending: t("users.pending"),
                banned: t("users.banned"),
              }}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("users.allStatus")}</SelectItem>
            <SelectItem value="active">{t("users.active")}</SelectItem>
            <SelectItem value="blocked">{t("users.blocked")}</SelectItem>
            <SelectItem value="pending">{t("users.pending")}</SelectItem>
            <SelectItem value="banned">{t("users.banned")}</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={handleSearch} className="w-full sm:w-auto">
          {t("common.search")}
        </Button>
      </div>

      {/* Bulk Actions — shared BulkActionBar shell */}
      {canWrite && (
        <BulkActionBar
          selectedCount={selectedIds.length}
          itemNoun="user"
          onClearSelection={() => setSelectedIds([])}
          actions={
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setBulkAction("block")}
              >
                <Ban className="mr-1 h-3.5 w-3.5" />
                {t("users.blockUser")}
              </Button>
              <Button
                variant="ghost"
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
            </>
          }
        />
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

      {/*
        Bulk Action Confirmation — upgraded to ConfirmDialog so:
          - Cancel/backdrop are swallowed while in-flight (no
            half-cancelled state)
          - Destructive variant for delete (red action button)
          - VI-default labels via Wave 27 P2 fix
          - Loading state surfaces "Đang xử lý 47/100..." progress
            (Wave 27 a11y P1-4) on slow networks
      */}
      <ConfirmDialog
        open={bulkAction !== null}
        onOpenChange={(open) => !open && !bulkBusy && setBulkAction(null)}
        title={
          bulkAction === "block"
            ? t("users.blockUsers")
            : bulkAction === "unblock"
              ? t("users.unblockUsers")
              : t("users.deleteUsers")
        }
        description={
          <>
            {t("users.bulkConfirm")
              .replace("{action}", bulkAction ?? "")
              .replace("{count}", String(selectedIds.length))}
            {bulkAction === "delete" && ` ${t("users.softDeleteNote")}`}
          </>
        }
        variant={bulkAction === "delete" ? "destructive" : "default"}
        loading={bulkBusy}
        confirmText={
          bulkBusy
            ? `Đang xử lý ${bulkProgress}/${selectedIds.length}…`
            : t("common.confirm")
        }
        cancelText={t("common.cancel")}
        onConfirm={handleBulkAction}
      />
    </div>
  );
}
