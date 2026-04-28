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
import { buildCsv } from "@/lib/csv";

interface HistoryRecord {
  id: string;
  proxy_id: string | null;
  tele_user_id: string | null;
  status: string;
  approval_mode: string | null;
  requested_at: string;
  processed_at: string | null;
  expires_at: string | null;
  tele_user?: {
    id: string;
    username: string | null;
    first_name: string | null;
    telegram_id: number;
  };
  admin?: {
    full_name: string | null;
    email: string;
  };
  proxy?: {
    id: string;
    host: string;
    port: number;
    type: string;
  };
}

export default function HistoryPage() {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const pageSize = 20;

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortBy: "processed_at",
        sortOrder: "desc",
      });

      // Filter to only processed requests
      const statusValues =
        statusFilter && statusFilter !== "all"
          ? statusFilter
          : "approved,auto_approved,rejected";
      params.set("status", statusValues);

      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (userSearch) params.set("search", userSearch);

      const res = await fetch(`/api/requests?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch history");

      const json = await res.json();
      if (json.success && json.data) {
        setRecords(json.data.data ?? []);
        setTotal(json.data.total ?? 0);
      }
    } catch (err) {
      console.error("Failed to fetch history:", err);
    } finally {
      setLoading(false);
    }
  }, [page, dateFrom, dateTo, userSearch, statusFilter]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleExport = () => {
    // Wave 22D-6: previous code did `row.join(",")` with NO escaping
    // — a username containing `,` or `"` corrupted every downstream
    // row. Worse: leading `=` / `+` / `-` / `@` triggered formula
    // execution when an admin opened the file in Excel/Sheets. Now
    // via buildCsv (formula-injection safe + RFC-4180 quoting).
    const csv = buildCsv<HistoryRecord>(records, [
      { header: "Proxy", value: (r) => (r.proxy ? `${r.proxy.host}:${r.proxy.port}` : "N/A") },
      { header: "User", value: (r) => r.tele_user?.username ?? r.tele_user?.first_name ?? "N/A" },
      { header: "Status", value: (r) => r.status },
      { header: "Processed By", value: (r) => r.admin?.full_name ?? r.admin?.email ?? "Auto" },
      {
        header: "Requested At",
        value: (r) => (r.requested_at ? format(new Date(r.requested_at), "yyyy-MM-dd HH:mm") : ""),
      },
      {
        header: "Processed At",
        value: (r) => (r.processed_at ? format(new Date(r.processed_at), "yyyy-MM-dd HH:mm") : ""),
      },
    ]);

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `proxy-history-${format(new Date(), "yyyyMMdd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(total / pageSize);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return <Badge variant="default">Đã duyệt</Badge>;
      case "auto_approved":
        return (
          <Badge variant="default" className="bg-emerald-600">
            Tự động duyệt
          </Badge>
        );
      case "rejected":
        return <Badge variant="destructive">Từ chối</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Lịch sử phân công
          </h1>
          <p className="text-muted-foreground">
            Kho lưu trữ chỉ đọc của tất cả kết quả yêu cầu proxy
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
            onClick={fetchHistory}
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
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Tìm theo người dùng..."
                value={userSearch}
                onChange={(e) => {
                  setUserSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v ?? "");
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Trạng thái" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả trạng thái</SelectItem>
                <SelectItem value="approved">Đã duyệt</SelectItem>
                <SelectItem value="auto_approved">Tự động duyệt</SelectItem>
                <SelectItem value="rejected">Từ chối</SelectItem>
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
              placeholder="Từ ngày"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className="w-[160px]"
              placeholder="Đến ngày"
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proxy</TableHead>
                <TableHead>Người dùng</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Xử lý bởi</TableHead>
                <TableHead>Yêu cầu lúc</TableHead>
                <TableHead>Xử lý lúc</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : records.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Không tìm thấy lịch sử
                  </TableCell>
                </TableRow>
              ) : (
                records.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-mono text-sm">
                      {record.proxy
                        ? `${record.proxy.host}:${record.proxy.port}`
                        : "N/A"}
                    </TableCell>
                    <TableCell>
                      {record.tele_user?.username ??
                        record.tele_user?.first_name ??
                        "N/A"}
                    </TableCell>
                    <TableCell>{getStatusBadge(record.status)}</TableCell>
                    <TableCell>
                      {record.admin?.full_name ??
                        record.admin?.email ?? (
                          <span className="text-muted-foreground">Auto</span>
                        )}
                    </TableCell>
                    <TableCell>
                      {record.requested_at
                        ? format(
                            new Date(record.requested_at),
                            "yyyy-MM-dd HH:mm"
                          )
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {record.processed_at
                        ? format(
                            new Date(record.processed_at),
                            "yyyy-MM-dd HH:mm"
                          )
                        : "-"}
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
