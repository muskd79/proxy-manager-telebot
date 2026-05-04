"use client";

/**
 * Wave 26-D-pre2 — trash-requests polish (mirrors trash-proxies +
 * trash-users patterns shipped earlier).
 *
 * Same upgrades:
 *   - Vietnamese labels
 *   - Selection checkboxes + bulk-restore + bulk-permanent-delete
 *     (typed-confirm)
 *   - Countdown badge "Tự xoá sau"
 *   - Toast feedback
 *   - Empty state with icon + Vietnamese copy
 *   - Status pill mapped to single source of truth (Vietnamese label)
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { RefreshCw, Trash2, RotateCcw, AlertTriangle, FileX } from "lucide-react";
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
// Wave 27 UX-4 — adopt shared BulkActionBar shell (see trash-proxies header).
import { BulkActionBar } from "@/components/shared/bulk-action-bar";
import { cn } from "@/lib/utils";
import {
  computeTrashCountdown,
  formatDeletedAt,
  TRASH_TONE_CLASSES,
} from "./trash-utils";

interface DeletedRequest {
  id: string;
  proxy_type: string | null;
  status: string;
  requested_at: string;
  deleted_at: string | null;
}

interface TrashRequestsProps {
  canWrite: boolean;
}

// Wave 27 UX [ui-ux #3] — moved to trash-utils.ts as TRASH_TONE_CLASSES.

// Wave 27 craft review [code-reviewer #3] — replaced inline map with
// canonical helper from proxy-labels.ts. The `requestStatusLabel`
// function safely falls back to the raw enum string for unknown
// values, avoiding the TS index-narrowing issue with a typed map.
import { requestStatusLabel } from "@/lib/proxy-labels";

function formatRequestedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function TrashRequests({ canWrite }: TrashRequestsProps) {
  const [requests, setRequests] = useState<DeletedRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingAction, setPendingAction] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [singleDeleteId, setSingleDeleteId] = useState<string | null>(null);
  const [bulkRestoreOpen, setBulkRestoreOpen] = useState(false);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/requests?isDeleted=true&pageSize=200");
      if (res.ok) {
        const result = await res.json();
        setRequests(result.data?.data ?? []);
      }
    } catch (err) {
      console.error("Failed to fetch deleted requests:", err);
      toast.error("Không tải được danh sách thùng rác");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => requests.some((r) => r.id === id)));
  }, [requests]);

  const allSelected =
    requests.length > 0 && requests.every((r) => selectedIds.includes(r.id));
  const someSelected = !allSelected && selectedIds.length > 0;

  function toggleAll() {
    if (allSelected) setSelectedIds([]);
    else setSelectedIds(requests.map((r) => r.id));
  }
  function toggleOne(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  // ─── Single-row actions ───
  async function handleRestore(id: string) {
    setPendingAction(true);
    try {
      const res = await fetch(`/api/requests/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_deleted: false, deleted_at: null }),
      });
      if (res.ok) {
        toast.success("Đã khôi phục yêu cầu");
        await fetchRequests();
      } else {
        toast.error("Khôi phục thất bại");
      }
    } catch (err) {
      console.error("Failed to restore request:", err);
      toast.error("Khôi phục thất bại");
    } finally {
      setPendingAction(false);
    }
  }

  async function handlePermanentDelete(id: string) {
    setPendingAction(true);
    try {
      const res = await fetch(`/api/requests/${id}?permanent=true`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Đã xoá vĩnh viễn yêu cầu");
        await fetchRequests();
      } else {
        toast.error("Xoá vĩnh viễn thất bại");
      }
    } catch (err) {
      console.error("Failed to permanently delete request:", err);
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
        const res = await fetch(`/api/requests/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_deleted: false, deleted_at: null }),
        });
        if (res.ok) successCount++;
      } catch (err) {
        console.error(`Failed to restore request ${id}:`, err);
      }
    }
    toast.success(`Đã khôi phục ${successCount}/${selectedIds.length} yêu cầu`);
    setSelectedIds([]);
    setBulkRestoreOpen(false);
    setPendingAction(false);
    await fetchRequests();
  }

  async function handleBulkPermanentDelete() {
    setPendingAction(true);
    let successCount = 0;
    for (const id of selectedIds) {
      try {
        const res = await fetch(`/api/requests/${id}?permanent=true`, { method: "DELETE" });
        if (res.ok) successCount++;
      } catch (err) {
        console.error(`Failed to delete request ${id}:`, err);
      }
    }
    if (successCount > 0) {
      toast.success(`Đã xoá vĩnh viễn ${successCount}/${selectedIds.length} yêu cầu`);
    } else {
      toast.error("Không xoá được yêu cầu nào");
    }
    setSelectedIds([]);
    setBulkDeleteOpen(false);
    setPendingAction(false);
    await fetchRequests();
  }

  const toBeDeletedSoonCount = useMemo(
    () =>
      requests.filter((r) => {
        const c = computeTrashCountdown(r.deleted_at);
        return c.tone !== "ok";
      }).length,
    [requests],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="text-sm text-muted-foreground">
          {loading ? (
            "Đang tải..."
          ) : requests.length === 0 ? (
            "Thùng rác trống"
          ) : (
            <>
              <span className="font-medium text-foreground">{requests.length}</span>{" "}
              yêu cầu trong thùng rác
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
          onClick={() => fetchRequests()}
          disabled={loading}
          aria-label="Tải lại"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {canWrite && (
        <BulkActionBar
          selectedCount={selectedIds.length}
          itemNoun="yêu cầu"
          onClearSelection={() => setSelectedIds([])}
          actions={
            <>
              <Button
                variant="ghost"
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
            </>
          }
        />
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
                      aria-label="Chọn tất cả yêu cầu trong thùng rác"
                    />
                  </TableHead>
                )}
                <TableHead>ID yêu cầu</TableHead>
                <TableHead className="w-24">Loại proxy</TableHead>
                <TableHead className="w-32">Trạng thái</TableHead>
                <TableHead className="w-44">Tạo lúc</TableHead>
                <TableHead className="w-44">Xoá lúc</TableHead>
                <TableHead className="w-36">Tự xoá sau</TableHead>
                {canWrite && (
                  <TableHead className="w-48 text-right">Thao tác</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: canWrite ? 8 : 6 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : requests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canWrite ? 8 : 6} className="py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <FileX className="size-8 opacity-30" aria-hidden="true" />
                      <p className="text-sm font-medium">Thùng rác trống</p>
                      <p className="text-xs">
                        Yêu cầu đã xoá mềm sẽ xuất hiện ở đây.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                requests.map((req) => {
                  const countdown = computeTrashCountdown(req.deleted_at);
                  const selected = selectedIds.includes(req.id);
                  return (
                    <TableRow
                      key={req.id}
                      className={selected ? "bg-muted/50" : ""}
                      aria-selected={selected}
                    >
                      {canWrite && (
                        <TableCell>
                          <Checkbox
                            checked={selected}
                            onCheckedChange={() => toggleOne(req.id)}
                            aria-label={`Chọn yêu cầu ${req.id.slice(0, 8)}`}
                          />
                        </TableCell>
                      )}
                      <TableCell className="font-mono text-xs select-all">
                        {req.id.slice(0, 8)}…
                      </TableCell>
                      <TableCell>
                        {req.proxy_type ? (
                          <Badge variant="outline" className="text-xs uppercase">
                            {req.proxy_type}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {requestStatusLabel(req.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatRequestedAt(req.requested_at)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDeletedAt(req.deleted_at)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs whitespace-nowrap",
                            TRASH_TONE_CLASSES[countdown.tone],
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
                              onClick={() => handleRestore(req.id)}
                              disabled={pendingAction}
                            >
                              <RotateCcw className="mr-1 size-3.5" />
                              Khôi phục
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => setSingleDeleteId(req.id)}
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
        title="Xoá vĩnh viễn yêu cầu này?"
        description="Sau khi xoá vĩnh viễn, không thể khôi phục lại được nữa."
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
        title={`Khôi phục ${selectedIds.length} yêu cầu?`}
        description="Các yêu cầu được chọn sẽ trở lại danh sách hoạt động."
        confirmText="Khôi phục"
        cancelText="Huỷ"
        loading={pendingAction}
        onConfirm={handleBulkRestore}
      />

      <DangerousConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Xoá VĨNH VIỄN ${selectedIds.length} yêu cầu?`}
        description={
          <div className="space-y-2">
            <p>
              Hành động này không thể khôi phục. Toàn bộ {selectedIds.length} yêu
              cầu được chọn sẽ bị xoá khỏi cơ sở dữ liệu.
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
