"use client";

/**
 * Wave 26-D-pre2 — trash-users polish (mirrors trash-proxies pattern
 * shipped in Wave 26-D-post1/D).
 *
 * Same upgrades:
 *   - Vietnamese labels throughout
 *   - Selection checkboxes + bulk-restore + bulk-permanent-delete
 *     (typed-confirm via DangerousConfirmDialog)
 *   - Countdown badge "Tự xoá sau" with tone (ok/warn/danger)
 *   - Toast feedback
 *   - Empty state with icon + Vietnamese copy
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { RefreshCw, Trash2, RotateCcw, AlertTriangle, UserX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DangerousConfirmDialog } from "@/components/shared/dangerous-confirm-dialog";
import { cn } from "@/lib/utils";
import {
  computeTrashCountdown,
  formatDeletedAt,
} from "./trash-utils";

interface DeletedUser {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  status: string;
  deleted_at: string | null;
}

interface TrashUsersProps {
  canWrite: boolean;
}

const TONE_CLASS = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  danger: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200",
} as const;

export function TrashUsers({ canWrite }: TrashUsersProps) {
  const [users, setUsers] = useState<DeletedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingAction, setPendingAction] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [singleDeleteId, setSingleDeleteId] = useState<string | null>(null);
  const [bulkRestoreOpen, setBulkRestoreOpen] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users?isDeleted=true&pageSize=200");
      if (res.ok) {
        const result = await res.json();
        setUsers(result.data?.data ?? []);
      }
    } catch (err) {
      console.error("Failed to fetch deleted users:", err);
      toast.error("Không tải được danh sách thùng rác");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => users.some((u) => u.id === id)));
  }, [users]);

  const allSelected = users.length > 0 && users.every((u) => selectedIds.includes(u.id));
  const someSelected = !allSelected && selectedIds.length > 0;

  function toggleAll() {
    if (allSelected) setSelectedIds([]);
    else setSelectedIds(users.map((u) => u.id));
  }
  function toggleOne(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function userLabel(u: DeletedUser): string {
    if (u.username) return `@${u.username}`;
    if (u.first_name) return u.first_name;
    return String(u.telegram_id);
  }

  // ─── Single-row actions ───
  async function handleRestore(id: string, label: string) {
    setPendingAction(true);
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_deleted: false, deleted_at: null }),
      });
      if (res.ok) {
        toast.success(`Đã khôi phục ${label}`);
        await fetchUsers();
      } else {
        toast.error(`Khôi phục ${label} thất bại`);
      }
    } catch (err) {
      console.error("Failed to restore user:", err);
      toast.error("Khôi phục thất bại");
    } finally {
      setPendingAction(false);
    }
  }

  async function handlePermanentDelete(id: string) {
    setPendingAction(true);
    try {
      const res = await fetch(`/api/users/${id}?permanent=true`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Đã xoá vĩnh viễn user");
        await fetchUsers();
      } else {
        toast.error("Xoá vĩnh viễn thất bại");
      }
    } catch (err) {
      console.error("Failed to permanently delete user:", err);
      toast.error("Xoá vĩnh viễn thất bại");
    } finally {
      setPendingAction(false);
      setSingleDeleteId(null);
    }
  }

  // ─── Bulk actions ───
  async function handleBulkRestore() {
    setPendingAction(true);
    let successCount = 0;
    for (const id of selectedIds) {
      try {
        const res = await fetch(`/api/users/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_deleted: false, deleted_at: null }),
        });
        if (res.ok) successCount++;
      } catch (err) {
        console.error(`Failed to restore user ${id}:`, err);
      }
    }
    toast.success(`Đã khôi phục ${successCount}/${selectedIds.length} user`);
    setSelectedIds([]);
    setBulkRestoreOpen(false);
    setPendingAction(false);
    await fetchUsers();
  }

  async function handleBulkPermanentDelete() {
    setPendingAction(true);
    let successCount = 0;
    for (const id of selectedIds) {
      try {
        const res = await fetch(`/api/users/${id}?permanent=true`, { method: "DELETE" });
        if (res.ok) successCount++;
      } catch (err) {
        console.error(`Failed to delete user ${id}:`, err);
      }
    }
    if (successCount > 0) {
      toast.success(`Đã xoá vĩnh viễn ${successCount}/${selectedIds.length} user`);
    } else {
      toast.error("Không xoá được user nào");
    }
    setSelectedIds([]);
    setBulkDeleteOpen(false);
    setPendingAction(false);
    await fetchUsers();
  }

  const toBeDeletedSoonCount = useMemo(
    () =>
      users.filter((u) => {
        const c = computeTrashCountdown(u.deleted_at);
        return c.tone !== "ok";
      }).length,
    [users],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="text-sm text-muted-foreground">
          {loading ? (
            "Đang tải..."
          ) : users.length === 0 ? (
            "Thùng rác trống"
          ) : (
            <>
              <span className="font-medium text-foreground">{users.length}</span>{" "}
              user trong thùng rác
              {toBeDeletedSoonCount > 0 && (
                <span className="ml-2 text-amber-600 dark:text-amber-400">
                  · {toBeDeletedSoonCount} sắp bị xoá vĩnh viễn
                </span>
              )}
            </>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchUsers()}
          disabled={loading}
          aria-label="Tải lại"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {selectedIds.length > 0 && canWrite && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 p-3">
          <span className="text-sm font-medium">Đã chọn {selectedIds.length} user</span>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkRestoreOpen(true)}
              disabled={pendingAction}
            >
              <RotateCcw className="mr-1 size-3.5" />
              Khôi phục đã chọn
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setBulkDeleteOpen(true)}
              disabled={pendingAction}
            >
              <Trash2 className="mr-1 size-3.5" />
              Xoá vĩnh viễn
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {canWrite && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Chọn tất cả user trong thùng rác"
                    />
                  </TableHead>
                )}
                <TableHead>Telegram ID</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Tên</TableHead>
                <TableHead className="w-44">Xoá lúc</TableHead>
                <TableHead className="w-36">Tự xoá sau</TableHead>
                {canWrite && <TableHead className="w-48 text-right">Thao tác</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: canWrite ? 7 : 5 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canWrite ? 7 : 5} className="py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <UserX className="size-8 opacity-30" aria-hidden="true" />
                      <p className="text-sm font-medium">Thùng rác trống</p>
                      <p className="text-xs">User đã xoá mềm sẽ xuất hiện ở đây.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => {
                  const countdown = computeTrashCountdown(user.deleted_at);
                  const selected = selectedIds.includes(user.id);
                  const label = userLabel(user);
                  return (
                    <TableRow
                      key={user.id}
                      className={selected ? "bg-muted/50" : ""}
                      aria-selected={selected}
                    >
                      {canWrite && (
                        <TableCell>
                          <Checkbox
                            checked={selected}
                            onCheckedChange={() => toggleOne(user.id)}
                            aria-label={`Chọn ${label}`}
                          />
                        </TableCell>
                      )}
                      <TableCell className="font-mono text-sm select-all">
                        {user.telegram_id}
                      </TableCell>
                      <TableCell>{user.username ? `@${user.username}` : "—"}</TableCell>
                      <TableCell>{user.first_name ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDeletedAt(user.deleted_at)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs whitespace-nowrap",
                            TONE_CLASS[countdown.tone],
                          )}
                        >
                          {countdown.tone === "danger" && (
                            <AlertTriangle className="mr-1 size-3" aria-hidden="true" />
                          )}
                          {countdown.label}
                        </Badge>
                      </TableCell>
                      {canWrite && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRestore(user.id, label)}
                              disabled={pendingAction}
                            >
                              <RotateCcw className="mr-1 size-3.5" />
                              Khôi phục
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => setSingleDeleteId(user.id)}
                              disabled={pendingAction}
                            >
                              <Trash2 className="mr-1 size-3.5" />
                              Xoá hẳn
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={singleDeleteId !== null}
        onOpenChange={(o) => {
          if (!o) setSingleDeleteId(null);
        }}
        variant="destructive"
        title="Xoá vĩnh viễn user này?"
        description="Sau khi xoá vĩnh viễn, không thể khôi phục lại được nữa. Mọi dữ liệu liên quan sẽ bị mất."
        confirmText="Xoá vĩnh viễn"
        cancelText="Huỷ"
        loading={pendingAction}
        onConfirm={async () => {
          if (singleDeleteId) await handlePermanentDelete(singleDeleteId);
        }}
      />

      <ConfirmDialog
        open={bulkRestoreOpen}
        onOpenChange={setBulkRestoreOpen}
        title={`Khôi phục ${selectedIds.length} user?`}
        description="Các user được chọn sẽ trở lại danh sách hoạt động."
        confirmText="Khôi phục"
        cancelText="Huỷ"
        loading={pendingAction}
        onConfirm={handleBulkRestore}
      />

      <DangerousConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Xoá VĨNH VIỄN ${selectedIds.length} user?`}
        description={
          <div className="space-y-2">
            <p>
              Hành động này không thể khôi phục. Tất cả dữ liệu (lịch sử request,
              chat, log hoạt động) liên quan tới {selectedIds.length} user sẽ
              mất theo.
            </p>
            <p className="text-xs text-muted-foreground">
              Gõ <code className="rounded bg-muted px-1 font-mono">XOA VINH VIEN</code> để xác nhận.
            </p>
          </div>
        }
        confirmString="XOA VINH VIEN"
        actionLabel="Xoá vĩnh viễn"
        loading={pendingAction}
        onConfirm={handleBulkPermanentDelete}
      />
    </div>
  );
}
