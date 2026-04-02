"use client";

import Link from "next/link";
import { format } from "date-fns";
import {
  Eye,
  CheckCircle,
  XCircle,
  ArrowUpDown,
  MoreHorizontal,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProxyRequest } from "@/types/database";
import type { RequestFilters } from "@/types/api";

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

interface RequestTableProps {
  requests: RequestWithUser[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isLoading: boolean;
  filters: RequestFilters;
  onFiltersChange: (filters: RequestFilters) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onView: (id: string) => void;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  approved: "default",
  auto_approved: "default",
  rejected: "destructive",
  expired: "secondary",
  cancelled: "secondary",
};

export function RequestTable({
  requests,
  total,
  page,
  pageSize,
  totalPages,
  isLoading,
  filters,
  onFiltersChange,
  onApprove,
  onReject,
  onView,
  selectedIds,
  onSelectionChange,
}: RequestTableProps) {
  const toggleSort = (column: string) => {
    const isSame = filters.sortBy === column;
    onFiltersChange({
      ...filters,
      sortBy: column,
      sortOrder: isSame && filters.sortOrder === "asc" ? "desc" : "asc",
    });
  };

  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((s) => s !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === requests.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(requests.map((r) => r.id));
    }
  };

  const SortHeader = ({
    column,
    children,
  }: {
    column: string;
    children: React.ReactNode;
  }) => (
    <TableHead>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3 h-8 text-xs font-semibold uppercase tracking-wider"
        onClick={() => toggleSort(column)}
      >
        {children}
        <ArrowUpDown className="ml-1 h-3 w-3" />
      </Button>
    </TableHead>
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12">
                <Checkbox
                  checked={requests.length > 0 && selectedIds.length === requests.length}
                  onCheckedChange={toggleSelectAll}
                />
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">
                User
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">
                Proxy Type
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">
                Country
              </TableHead>
              <SortHeader column="status">Status</SortHeader>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">
                Approval
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">
                Approved By
              </TableHead>
              <SortHeader column="requested_at">Requested</SortHeader>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">
                Processed
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-32 text-center text-muted-foreground">
                  No requests found.
                </TableCell>
              </TableRow>
            ) : (
              requests.map((req) => {
                const userName = req.tele_user
                  ? req.tele_user.username
                    ? `@${req.tele_user.username}`
                    : [req.tele_user.first_name, req.tele_user.last_name]
                        .filter(Boolean)
                        .join(" ") || `ID: ${req.tele_user.telegram_id}`
                  : req.tele_user_id;

                return (
                  <TableRow key={req.id} className="group">
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.includes(req.id)}
                        onCheckedChange={() => toggleSelect(req.id)}
                      />
                    </TableCell>
                    <TableCell>
                      {req.tele_user ? (
                        <Link
                          href={`/users/${req.tele_user.id}`}
                          className="text-primary hover:underline"
                        >
                          {userName}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{userName}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{req.proxy_type || "any"}</Badge>
                    </TableCell>
                    <TableCell>{req.country || "any"}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[req.status] ?? "outline"}>
                        {req.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {req.approval_mode || "--"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {req.admin?.full_name || req.admin?.email || "--"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(req.requested_at), "MMM d, HH:mm")}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {req.processed_at
                        ? format(new Date(req.processed_at), "MMM d, HH:mm")
                        : "--"}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-8 w-8 p-0" />}>
                            <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => onView(req.id)}>
                            <Eye className="mr-2 h-4 w-4" />
                            View Details
                          </DropdownMenuItem>
                          {req.status === "pending" && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => onApprove(req.id)}>
                                <CheckCircle className="mr-2 h-4 w-4" />
                                Approve
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => onReject(req.id)}
                                className="text-destructive focus:text-destructive"
                              >
                                <XCircle className="mr-2 h-4 w-4" />
                                Reject
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

    </>
  );
}
