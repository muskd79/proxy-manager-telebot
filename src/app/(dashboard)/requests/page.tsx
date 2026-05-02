"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  FileText,
  Search,
  XCircle,
  Zap,
  Filter,
  RefreshCw,
} from "lucide-react";
import { useRole } from "@/lib/role-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { RequestTable } from "@/components/requests/request-table";
import { Pagination } from "@/components/shared/pagination";
import {
  ApproveDialog,
  RejectDialog,
  BatchApproveDialog,
} from "@/components/requests/request-actions";
import type { ProxyRequest, RequestStatus } from "@/types/database";
import type { RequestFilters, PaginatedResponse, ApiResponse } from "@/types/api";
import { useI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";

interface RequestWithUser extends ProxyRequest {
  tele_user?: {
    id: string;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    telegram_id: number;
  };
  admin?: {
    full_name: string | null;
    email: string;
  };
}

export default function RequestsPage() {
  const { t } = useI18n();
  const { canWrite } = useRole();
  const [requests, setRequests] = useState<RequestWithUser[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  // Phase 3 (PM UX) — honor ?status= from URL on first mount so
  // dashboard drill-down + bookmarked filter URLs land correctly.
  // Defaults to "pending" if no param given. activeTab is string-
  // typed because the component also has a "recent" pseudo-tab
  // that doesn't map to a RequestStatus.
  const searchParams = useSearchParams();
  const initialStatus = (searchParams.get("status") as RequestStatus) || "pending";
  const [filters, setFilters] = useState<RequestFilters>({
    page: 1,
    pageSize: 20,
    sortBy: "requested_at",
    sortOrder: "desc",
    status: initialStatus,
  });
  const [activeTab, setActiveTab] = useState<string>(initialStatus);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchValue, setSearchValue] = useState("");

  // Dialog states
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [batchApproveOpen, setBatchApproveOpen] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string>("");

  const fetchRequests = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          params.set(key, String(value));
        }
      });

      // For the "recent" tab, fetch last 7 days of approved + rejected
      if (activeTab === "recent") {
        params.set("status", "approved,auto_approved,rejected");
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        params.set("dateFrom", sevenDaysAgo.toISOString().split("T")[0]);
        params.set("sortBy", "processed_at");
        params.set("sortOrder", "desc");
      }

      const res = await fetch(`/api/requests?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch requests");
      const json: ApiResponse<PaginatedResponse<RequestWithUser>> = await res.json();
      if (json.success && json.data) {
        setRequests(json.data.data);
        setTotal(json.data.total);
        setTotalPages(json.data.totalPages);
      }
    } catch (err) {
      console.error("Failed to load requests:", err);
      toast.error(t("requests.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [filters, activeTab]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // Realtime sync: re-fetch when proxy_requests table changes (debounced to reduce load)
  const requestsDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("requests-changes")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase JS realtime API does not export the literal union type for the event name
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "proxy_requests" }, () => {
        clearTimeout(requestsDebounceRef.current);
        requestsDebounceRef.current = setTimeout(() => {
          fetchRequests();
        }, 2000);
      })
      .subscribe();

    return () => {
      clearTimeout(requestsDebounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [fetchRequests]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === "pending") {
      setFilters({
        ...filters,
        status: "pending" as RequestStatus,
        dateFrom: undefined,
        sortBy: "requested_at",
        sortOrder: "desc",
        page: 1,
      });
    } else {
      // "recent" tab - status handled in fetchRequests
      setFilters({
        ...filters,
        status: undefined,
        page: 1,
      });
    }
    setSelectedIds([]);
  };

  const handleSearch = () => {
    setFilters({ ...filters, search: searchValue, page: 1 });
  };

  const handleApprove = (id: string) => {
    setActiveRequestId(id);
    setApproveDialogOpen(true);
  };

  const handleReject = (id: string) => {
    setActiveRequestId(id);
    setRejectDialogOpen(true);
  };

  const handleView = (id: string) => {
    setActiveRequestId(id);
    setApproveDialogOpen(false);
    setRejectDialogOpen(false);
  };

  const handleBatchReject = async () => {
    let successCount = 0;
    for (const id of selectedIds) {
      try {
        const res = await fetch(`/api/requests/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "rejected" }),
        });
        if (res.ok) successCount++;
      } catch (err) {
        console.error(`Failed to reject request ${id}:`, err);
      }
    }
    toast.success(t("requests.batchRejectResult").replace("{success}", String(successCount)).replace("{total}", String(selectedIds.length)));
    setSelectedIds([]);
    fetchRequests();
  };

  const pendingSelected = selectedIds.filter((id) =>
    requests.find((r) => r.id === id && r.status === "pending")
  );

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6">
      {/* Page Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t("requests.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("requests.subtitle")}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => fetchRequests()}
          disabled={isLoading}
          title="Tải lại"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="bg-muted">
            <TabsTrigger value="pending">{t("requests.pendingTab")}</TabsTrigger>
            <TabsTrigger value="recent">{t("requests.recentTab")}</TabsTrigger>
          </TabsList>

          {/* Filters */}
          <div className="flex gap-2">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t("requests.searchByUser")}
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="bg-background pl-10"
              />
            </div>
            <Button onClick={handleSearch} size="sm">
              <Filter className="mr-1 h-3.5 w-3.5" />
              {t("common.filter")}
            </Button>
          </div>
        </div>

        {/* Bulk Actions for pending */}
        {activeTab === "pending" && pendingSelected.length > 0 && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-3">
            <span className="text-sm font-medium">
              {t("requests.pendingSelected").replace("{count}", String(pendingSelected.length))}
            </span>
            {canWrite && (
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  onClick={() => setBatchApproveOpen(true)}
                >
                  <Zap className="mr-1 h-3.5 w-3.5" />
                  {t("requests.batchApprove")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleBatchReject}
                >
                  <XCircle className="mr-1 h-3.5 w-3.5" />
                  {t("requests.batchReject")}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Content for tabs */}
        {["pending", "recent"].map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-4">
            <RequestTable
              requests={requests}
              total={total}
              page={filters.page ?? 1}
              pageSize={filters.pageSize ?? 20}
              totalPages={totalPages}
              isLoading={isLoading}
              filters={filters}
              onFiltersChange={setFilters}
              onApprove={handleApprove}
              onReject={handleReject}
              onView={handleView}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
            />
          </TabsContent>
        ))}

        {/* Pagination */}
        <Pagination
          page={filters.page ?? 1}
          pageSize={filters.pageSize ?? 20}
          total={total}
          totalPages={totalPages}
          onPageChange={(p) => setFilters({ ...filters, page: p })}
          onPageSizeChange={(size) => setFilters({ ...filters, pageSize: size, page: 1 })}
        />
      </Tabs>

      {/* Dialogs */}
      <ApproveDialog
        open={approveDialogOpen}
        onOpenChange={setApproveDialogOpen}
        requestId={activeRequestId}
        onApproved={() => {
          fetchRequests();
          setSelectedIds([]);
        }}
      />
      <RejectDialog
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        requestId={activeRequestId}
        onRejected={() => {
          fetchRequests();
          setSelectedIds([]);
        }}
      />
      <BatchApproveDialog
        open={batchApproveOpen}
        onOpenChange={setBatchApproveOpen}
        requestIds={pendingSelected}
        onApproved={() => {
          fetchRequests();
          setSelectedIds([]);
        }}
      />
    </div>
  );
}
