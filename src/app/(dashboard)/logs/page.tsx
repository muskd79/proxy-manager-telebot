"use client";

import { useEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import { Download, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { Inbox } from "lucide-react";
import type { ActivityLog } from "@/types/database";
import { buildCsv } from "@/lib/csv";

const actorTypeBadgeVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  admin: "default",
  tele_user: "secondary",
  system: "outline",
  bot: "secondary",
};

export default function LogsPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [actorType, setActorType] = useState("all");
  const [action, setAction] = useState("");
  const [resourceType, setResourceType] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const pageSize = 25;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortBy: "created_at",
        sortOrder: "desc",
      });

      if (search) params.set("search", search);
      if (actorType && actorType !== "all") params.set("actorType", actorType);
      if (action) params.set("action", action);
      if (resourceType && resourceType !== "all")
        params.set("resourceType", resourceType);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const res = await fetch(`/api/logs?${params}`);
      if (res.ok) {
        const result = await res.json();
        setLogs(result.data ?? []);
        setTotal(result.total ?? 0);
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLoading(false);
    }
  }, [page, search, actorType, action, resourceType, dateFrom, dateTo]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleExport = () => {
    // Wave 22D-6: use shared buildCsv (formula-injection safe).
    const csv = buildCsv<ActivityLog>(logs, [
      { header: "Timestamp", value: (l) => format(new Date(l.created_at), "yyyy-MM-dd HH:mm:ss") },
      { header: "Actor Type", value: (l) => l.actor_type },
      // Wave 22D-2: include both display name AND raw ID — incidents
      // sometimes need the immutable UUID even when the human-readable
      // name has been edited.
      { header: "Actor", value: (l) => l.actor_display_name ?? "" },
      { header: "Actor ID", value: (l) => l.actor_id ?? "" },
      { header: "Action", value: (l) => l.action },
      { header: "Resource Type", value: (l) => l.resource_type ?? "" },
      { header: "Resource ID", value: (l) => l.resource_id ?? "" },
      { header: "Details", value: (l) => (l.details ? JSON.stringify(l.details) : "") },
    ]);

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activity-logs-${format(new Date(), "yyyyMMdd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="flex-1 space-y-4 p-4 sm:space-y-6 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Nhật ký hệ thống</h1>
          <p className="text-muted-foreground">
            Xem hành động admin + sự kiện hệ thống
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="size-4 mr-1.5" />
            Xuất CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchLogs}
            disabled={loading}
          >
            <RefreshCw
              className={`size-4 mr-1.5 ${loading ? "animate-spin" : ""}`}
            />
            Làm mới
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Bộ lọc</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Tìm trong chi tiết..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9"
              />
            </div>
            <Select
              value={actorType}
              onValueChange={(v) => {
                setActorType(v ?? '');
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Loại người thực hiện" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="tele_user">Tele User</SelectItem>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="bot">Bot</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Action..."
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
              className="w-[180px]"
            />
            <Select
              value={resourceType}
              onValueChange={(v) => {
                setResourceType(v ?? '');
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Loại tài nguyên" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả tài nguyên</SelectItem>
                <SelectItem value="proxy">Proxy</SelectItem>
                <SelectItem value="tele_user">Tele User</SelectItem>
                <SelectItem value="proxy_request">Request</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="setting">Setting</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className="w-[160px]"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className="w-[160px]"
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[170px]">Thời điểm</TableHead>
                <TableHead>Loại</TableHead>
                <TableHead>Người thực hiện</TableHead>
                <TableHead>Thao tác</TableHead>
                <TableHead>Tài nguyên</TableHead>
                <TableHead>ID tài nguyên</TableHead>
                <TableHead>Chi tiết</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState
                      icon={<Inbox className="h-10 w-10" />}
                      title="Không có nhật ký"
                      description="Không có nhật ký phù hợp với bộ lọc hiện tại. Thử điều chỉnh tiêu chí tìm kiếm."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {format(new Date(log.created_at), "yyyy-MM-dd HH:mm:ss")}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          actorTypeBadgeVariant[log.actor_type] ?? "outline"
                        }
                      >
                        {log.actor_type}
                      </Badge>
                    </TableCell>
                    {/* Wave 22D-2: prefer actor_display_name (point-in-time
                        snapshot from logger.ts / mig 034 backfill). Falls
                        back to truncated UUID for old rows that escaped the
                        backfill (e.g. orphaned actor_id pointing at a row
                        that no longer exists). */}
                    <TableCell className="text-xs">
                      {log.actor_display_name ? (
                        <span className="font-medium">{log.actor_display_name}</span>
                      ) : log.actor_id ? (
                        <span className="font-mono text-muted-foreground">
                          {log.actor_id.slice(0, 8)}...
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{log.action}</TableCell>
                    <TableCell>
                      {log.resource_type ? (
                        <Badge variant="outline">{log.resource_type}</Badge>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {log.resource_id
                        ? log.resource_id.slice(0, 8) + "..."
                        : "-"}
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate text-xs text-muted-foreground">
                      {log.details ? JSON.stringify(log.details) : "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-muted-foreground">
                Trang {page} / {totalPages} ({total} bản ghi)
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Trước
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Sau
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
