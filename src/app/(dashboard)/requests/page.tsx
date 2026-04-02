"use client";

import { useState, useCallback, useEffect } from "react";
import {
  FileText,
  Search,
  CheckCircle,
  XCircle,
  Zap,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { RequestTable } from "@/components/requests/request-table";
import {
  ApproveDialog,
  RejectDialog,
  BatchApproveDialog,
} from "@/components/requests/request-actions";
import type { ProxyRequest, RequestStatus } from "@/types/database";
import type { RequestFilters, PaginatedResponse, ApiResponse } from "@/types/api";

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
  const { canWrite } = useRole();
  const [requests, setRequests] = useState<RequestWithUser[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [filters, setFilters] = useState<RequestFilters>({
    page: 1,
    pageSize: 20,
    sortBy: "requested_at",
    sortOrder: "desc",
  });
  const [activeTab, setActiveTab] = useState("all");
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
      const res = await fetch(`/api/requests?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch requests");
      const json: ApiResponse<PaginatedResponse<RequestWithUser>> = await res.json();
      if (json.success && json.data) {
        setRequests(json.data.data);
        setTotal(json.data.total);
        setTotalPages(json.data.totalPages);
      }
    } catch {
      toast.error("Failed to load requests");
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    const statusMap: Record<string, RequestStatus | undefined> = {
      all: undefined,
      pending: "pending" as RequestStatus,
      approved: "approved" as RequestStatus,
      rejected: "rejected" as RequestStatus,
    };
    setFilters({
      ...filters,
      status: statusMap[tab],
      page: 1,
    });
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
    // Could navigate or open a detail dialog
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
      } catch {
        /* continue */
      }
    }
    toast.success(`${successCount}/${selectedIds.length} requests rejected`);
    setSelectedIds([]);
    fetchRequests();
  };

  const pendingSelected = selectedIds.filter((id) =>
    requests.find((r) => r.id === id && r.status === "pending")
  );

  return (
    <div className="space-y-6 p-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <FileText className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Proxy Requests</h1>
          <p className="text-sm text-muted-foreground">
            Manage proxy requests from Telegram users
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="bg-muted">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
          </TabsList>

          {/* Filters */}
          <div className="flex gap-2">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by user..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="bg-background pl-10"
              />
            </div>
            <Button onClick={handleSearch} size="sm">
              <Filter className="mr-1 h-3.5 w-3.5" />
              Filter
            </Button>
          </div>
        </div>

        {/* Bulk Actions for pending */}
        {pendingSelected.length > 0 && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-3">
            <span className="text-sm font-medium">
              {pendingSelected.length} pending request(s) selected
            </span>
            {canWrite && (
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  onClick={() => setBatchApproveOpen(true)}
                >
                  <Zap className="mr-1 h-3.5 w-3.5" />
                  Batch Approve
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleBatchReject}
                >
                  <XCircle className="mr-1 h-3.5 w-3.5" />
                  Batch Reject
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Content for all tabs is the same table with different filters */}
        {["all", "pending", "approved", "rejected"].map((tab) => (
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
