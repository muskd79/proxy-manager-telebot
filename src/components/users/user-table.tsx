"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  Eye,
  Ban,
  CheckCircle,
  Trash2,
  Settings,
  ArrowUpDown,
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
import { Skeleton } from "@/components/ui/skeleton";
import type { TeleUser, TeleUserStatus, ApprovalMode } from "@/types/database";
import type { UserFilters } from "@/types/api";

interface UserTableProps {
  users: TeleUser[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isLoading: boolean;
  filters: UserFilters;
  onFiltersChange: (filters: UserFilters) => void;
  onBlock: (id: string) => Promise<boolean>;
  onUnblock: (id: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onRefresh: () => void;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  blocked: "destructive",
  pending: "outline",
  banned: "destructive",
};

const statusLabel: Record<string, string> = {
  active: "Active",
  blocked: "Blocked",
  pending: "Pending",
  banned: "Banned",
};

const approvalLabel: Record<string, string> = {
  auto: "Auto",
  manual: "Manual",
};

export function UserTable({
  users,
  total,
  page,
  pageSize,
  totalPages,
  isLoading,
  filters,
  onFiltersChange,
  onBlock,
  onUnblock,
  onDelete,
  onRefresh,
  selectedIds,
  onSelectionChange,
}: UserTableProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

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
    if (selectedIds.length === users.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(users.map((u) => u.id));
    }
  };

  const handleDelete = async () => {
    if (!deleteTargetId) return;
    await onDelete(deleteTargetId);
    setDeleteDialogOpen(false);
    setDeleteTargetId(null);
    onRefresh();
  };

  const handleBlockToggle = async (user: TeleUser) => {
    if (user.status === "blocked" || user.status === "banned") {
      await onUnblock(user.id);
    } else {
      await onBlock(user.id);
    }
    onRefresh();
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
                  checked={users.length > 0 && selectedIds.length === users.length}
                  onCheckedChange={toggleSelectAll}
                />
              </TableHead>
              <SortHeader column="telegram_id">Telegram ID</SortHeader>
              <SortHeader column="username">Username</SortHeader>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">
                Name
              </TableHead>
              <SortHeader column="status">Status</SortHeader>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">
                Proxies
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">
                Rate Limits (H/D/T)
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">
                Approval
              </TableHead>
              <SortHeader column="created_at">Created</SortHeader>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-32 text-center text-muted-foreground">
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id} className="group">
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.includes(user.id)}
                      onCheckedChange={() => toggleSelect(user.id)}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {user.telegram_id}
                  </TableCell>
                  <TableCell>
                    {user.username ? (
                      <span className="text-primary">@{user.username}</span>
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {[user.first_name, user.last_name].filter(Boolean).join(" ") || (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[user.status] ?? "outline"}>
                      {statusLabel[user.status] ?? user.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {user.proxies_used_total}/{user.max_proxies}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <span title="Hourly">{user.proxies_used_hourly}/{user.rate_limit_hourly}</span>
                    {" / "}
                    <span title="Daily">{user.proxies_used_daily}/{user.rate_limit_daily}</span>
                    {" / "}
                    <span title="Total">{user.proxies_used_total}/{user.rate_limit_total}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.approval_mode === "auto" ? "secondary" : "outline"}>
                      {approvalLabel[user.approval_mode] ?? user.approval_mode}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(user.created_at), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-8 w-8 p-0" />}>
                          <Settings className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem>
                            <Link href={`/users/${user.id}`} className="flex items-center w-full">
                              <Eye className="mr-2 h-4 w-4" />
                              View Details
                            </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                            <Link href={`/users/${user.id}?tab=rate-limits`} className="flex items-center w-full">
                              <Settings className="mr-2 h-4 w-4" />
                              Edit Rate Limits
                            </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleBlockToggle(user)}>
                          {user.status === "blocked" || user.status === "banned" ? (
                            <>
                              <CheckCircle className="mr-2 h-4 w-4" />
                              Unblock User
                            </>
                          ) : (
                            <>
                              <Ban className="mr-2 h-4 w-4" />
                              Block User
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => {
                            setDeleteTargetId(user.id);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete User
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              This will soft-delete the user. They will no longer be able to use the bot.
              This action can be reversed from the trash.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
