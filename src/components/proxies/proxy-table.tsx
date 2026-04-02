"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreHorizontal,
  Eye,
  Pencil,
  UserPlus,
  Activity,
  Trash2,
  ArrowUpDown,
} from "lucide-react";
import type { Proxy } from "@/types/database";
import Link from "next/link";

interface ProxyTableProps {
  proxies: Proxy[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onSort: (column: string) => void;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onEdit: (proxy: Proxy) => void;
  onDelete: (id: string) => void;
  onHealthCheck: (ids: string[]) => void;
}

const statusVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  available: "default",
  assigned: "secondary",
  expired: "destructive",
  banned: "destructive",
  maintenance: "outline",
};

const statusColors: Record<string, string> = {
  available: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  assigned: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  expired: "bg-red-500/10 text-red-500 border-red-500/20",
  banned: "bg-red-700/10 text-red-700 border-red-700/20",
  maintenance: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
};

const typeColors: Record<string, string> = {
  http: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  https: "bg-green-500/10 text-green-500 border-green-500/20",
  socks5: "bg-purple-500/10 text-purple-500 border-purple-500/20",
};

export function ProxyTable({
  proxies,
  selectedIds,
  onSelectionChange,
  onSort,
  sortBy,
  sortOrder,
  onEdit,
  onDelete,
  onHealthCheck,
}: ProxyTableProps) {
  const allSelected =
    proxies.length > 0 && proxies.every((p) => selectedIds.has(p.id));
  const someSelected = proxies.some((p) => selectedIds.has(p.id));

  function toggleAll() {
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(proxies.map((p) => p.id)));
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onSelectionChange(next);
  }

  function SortableHead({
    column,
    children,
  }: {
    column: string;
    children: React.ReactNode;
  }) {
    return (
      <TableHead>
        <button
          onClick={() => onSort(column)}
          className="flex items-center gap-1 hover:text-foreground transition-colors"
        >
          {children}
          <ArrowUpDown
            className={`size-3 ${
              sortBy === column ? "text-foreground" : "text-muted-foreground/50"
            }`}
          />
        </button>
      </TableHead>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected && !allSelected}
              onCheckedChange={toggleAll}
            />
          </TableHead>
          <SortableHead column="host">Host:Port</SortableHead>
          <SortableHead column="type">Type</SortableHead>
          <SortableHead column="status">Status</SortableHead>
          <TableHead>Country</TableHead>
          <TableHead>Assigned To</TableHead>
          <SortableHead column="speed_ms">Speed</SortableHead>
          <SortableHead column="expires_at">Expires</SortableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {proxies.length === 0 ? (
          <TableRow>
            <TableCell colSpan={9} className="text-center py-8">
              <p className="text-muted-foreground">No proxies found</p>
            </TableCell>
          </TableRow>
        ) : (
          proxies.map((proxy) => (
            <TableRow
              key={proxy.id}
              className={selectedIds.has(proxy.id) ? "bg-muted/50" : ""}
            >
              <TableCell>
                <Checkbox
                  checked={selectedIds.has(proxy.id)}
                  onCheckedChange={() => toggleOne(proxy.id)}
                />
              </TableCell>
              <TableCell className="font-mono text-sm">
                <Link
                  href={`/proxies/${proxy.id}`}
                  className="hover:underline"
                >
                  {proxy.host}:{proxy.port}
                </Link>
              </TableCell>
              <TableCell>
                <span
                  className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
                    typeColors[proxy.type] || ""
                  }`}
                >
                  {proxy.type.toUpperCase()}
                </span>
              </TableCell>
              <TableCell>
                <span
                  className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
                    statusColors[proxy.status] || ""
                  }`}
                >
                  {proxy.status}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {proxy.country || "-"}
              </TableCell>
              <TableCell>
                {proxy.assigned_to ? (
                  <Link
                    href={`/users/${proxy.assigned_to}`}
                    className="text-sm text-blue-400 hover:underline"
                  >
                    View user
                  </Link>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell>
                {proxy.speed_ms != null ? (
                  <span
                    className={`text-sm ${
                      proxy.speed_ms < 500
                        ? "text-emerald-500"
                        : proxy.speed_ms < 1000
                        ? "text-yellow-500"
                        : "text-red-500"
                    }`}
                  >
                    {proxy.speed_ms}ms
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {proxy.expires_at
                  ? new Date(proxy.expires_at).toLocaleDateString()
                  : "-"}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="ghost" size="icon-xs">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      render={<Link href={`/proxies/${proxy.id}`} />}
                    >
                      <Eye className="size-4" />
                      View Details
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onEdit(proxy)}>
                      <Pencil className="size-4" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onHealthCheck([proxy.id])}
                    >
                      <Activity className="size-4" />
                      Health Check
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => onDelete(proxy.id)}
                    >
                      <Trash2 className="size-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
