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

interface HistoryRecord {
  id: string;
  proxy: {
    id: string;
    host: string;
    port: number;
    type: string;
  } | null;
  tele_user: {
    id: string;
    username: string | null;
    first_name: string | null;
    telegram_id: number;
  } | null;
  status: string;
  approval_mode: string | null;
  approved_by: string | null;
  requested_at: string;
  processed_at: string | null;
  expires_at: string | null;
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
        sortBy: "requested_at",
        sortOrder: "desc",
      });
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (userSearch) params.set("search", userSearch);
      if (statusFilter && statusFilter !== "all")
        params.set("status", statusFilter);

      const res = await fetch(`/api/proxies?isDeleted=false&${params}`);
      if (!res.ok) throw new Error("Failed to fetch");

      // We re-use proxy_requests for history via a dedicated endpoint
      // For now, fetch from proxy_requests with joined data
      const historyRes = await fetch(
        `/api/logs?resourceType=proxy&action=proxy_auto_assigned,proxy_request_created&${params}`
      );

      if (historyRes.ok) {
        const result = await historyRes.json();
        setRecords(result.data ?? []);
        setTotal(result.total ?? 0);
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
    const headers = [
      "Proxy",
      "User",
      "Status",
      "Assigned By",
      "Assigned At",
      "Expires At",
    ];
    const rows = records.map((r) => [
      r.proxy ? `${r.proxy.host}:${r.proxy.port}` : "N/A",
      r.tele_user?.username ?? r.tele_user?.first_name ?? "N/A",
      r.status,
      r.approved_by ?? "Auto",
      r.requested_at ? format(new Date(r.requested_at), "yyyy-MM-dd HH:mm") : "",
      r.expires_at ? format(new Date(r.expires_at), "yyyy-MM-dd HH:mm") : "",
    ]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `proxy-history-${format(new Date(), "yyyyMMdd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Assignment History
          </h1>
          <p className="text-muted-foreground">
            Proxy assignment and request history
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="size-4 mr-1.5" />
            Export CSV
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
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search by user..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? '')}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="auto_approved">Auto Approved</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-[160px]"
              placeholder="From date"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-[160px]"
              placeholder="To date"
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
                <TableHead>User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned By</TableHead>
                <TableHead>Assigned At</TableHead>
                <TableHead>Expires At</TableHead>
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
                    No history records found
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
                    <TableCell>
                      <Badge
                        variant={
                          record.status === "approved" ||
                          record.status === "auto_approved"
                            ? "default"
                            : record.status === "pending"
                            ? "secondary"
                            : "destructive"
                        }
                      >
                        {record.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {record.approved_by ?? (
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
                      {record.expires_at
                        ? format(
                            new Date(record.expires_at),
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
                Page {page} of {totalPages} ({total} records)
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
