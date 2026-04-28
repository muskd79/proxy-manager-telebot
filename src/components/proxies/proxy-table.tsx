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
  Activity,
  Trash2,
  ArrowUpDown,
} from "lucide-react";
import type { Proxy } from "@/types/database";
import {
  networkTypeLabel,
  proxyStatusBadges,
  TYPE_LABEL,
  type NetworkType,
} from "@/lib/proxy-labels";
import Link from "next/link";

/**
 * Wave 22J — proxy table rebuild.
 *
 * Column changes per user request:
 *   - Headers fully Vietnamese
 *   - NEW "Phân loại" column showing network_type (ISP / Datacenter
 *     IPv4 / Datacenter IPv6 / Dân cư / Mobile / Static Residential)
 *   - "Trạng thái" column now renders MULTIPLE badges from
 *     proxyStatusBadges() — combines lifecycle status + expiry
 *     state + hidden flag, all visible at once
 *   - REMOVED "Tags" column (column dropped in mig 037)
 *   - Date displays use vi-VN locale
 */

interface ProxyTableProps {
  proxies: Proxy[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onSort: (column: string) => void;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onEdit: (proxy: Proxy) => void;
  onDelete: (id: string) => void;
  onHealthCheck: (ids: string[]) => void;
}

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
    proxies.length > 0 && proxies.every((p) => selectedIds.includes(p.id));
  const someSelected = proxies.some((p) => selectedIds.includes(p.id));

  function toggleAll() {
    if (allSelected) onSelectionChange([]);
    else onSelectionChange(proxies.map((p) => p.id));
  }

  function toggleOne(id: string) {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((x) => x !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  }

  function SortableHead({
    column,
    children,
  }: {
    column: string;
    children: React.ReactNode;
  }) {
    return (
      <TableHead
        aria-sort={
          sortBy === column
            ? sortOrder === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
      >
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
    <Table aria-label="Danh sách proxy" aria-rowcount={proxies.length}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected && !allSelected}
              onCheckedChange={toggleAll}
              aria-label="Chọn tất cả proxy"
            />
          </TableHead>
          <SortableHead column="host">Host:Cổng</SortableHead>
          <SortableHead column="type">Giao thức</SortableHead>
          <TableHead>Phân loại</TableHead>
          <TableHead>Trạng thái</TableHead>
          <SortableHead column="country">Quốc gia</SortableHead>
          <TableHead>ISP</TableHead>
          <TableHead>Người dùng</TableHead>
          <SortableHead column="speed_ms">Tốc độ</SortableHead>
          <SortableHead column="expires_at">Ngày hết hạn</SortableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {proxies.length === 0 ? (
          <TableRow>
            <TableCell colSpan={11} className="text-center py-8">
              <p className="text-muted-foreground">Chưa có proxy nào</p>
            </TableCell>
          </TableRow>
        ) : (
          proxies.map((proxy) => {
            const statusList = proxyStatusBadges(proxy);
            return (
              <TableRow
                key={proxy.id}
                className={selectedIds.includes(proxy.id) ? "bg-muted/50" : ""}
                aria-selected={selectedIds.includes(proxy.id)}
                tabIndex={0}
              >
                <TableCell>
                  <Checkbox
                    checked={selectedIds.includes(proxy.id)}
                    onCheckedChange={() => toggleOne(proxy.id)}
                  />
                </TableCell>
                <TableCell className="font-mono text-sm">
                  <Link href={`/proxies/${proxy.id}`} className="hover:underline">
                    {proxy.host}:{proxy.port}
                  </Link>
                </TableCell>
                <TableCell>
                  <span
                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${typeColors[proxy.type] || ""}`}
                  >
                    {TYPE_LABEL[proxy.type] ?? proxy.type.toUpperCase()}
                  </span>
                </TableCell>
                <TableCell className="text-xs">
                  {proxy.network_type ? (
                    <Badge variant="outline" className="text-xs">
                      {networkTypeLabel(proxy.network_type as NetworkType)}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">Chưa phân loại</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {statusList.length === 0 ? (
                      <span className="text-muted-foreground text-xs">-</span>
                    ) : (
                      statusList.map((b, i) => (
                        <Badge
                          key={`${b.label}-${i}`}
                          variant={b.variant}
                          className={`text-xs ${b.tone === "muted" ? "opacity-70" : ""}`}
                        >
                          {b.label}
                        </Badge>
                      ))
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {proxy.country || "-"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {proxy.isp || "-"}
                </TableCell>
                <TableCell>
                  {proxy.assigned_to ? (
                    <Link
                      href={`/users/${proxy.assigned_to}`}
                      className="text-sm text-blue-400 hover:underline"
                    >
                      Xem
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
                    ? new Date(proxy.expires_at).toLocaleDateString("vi-VN")
                    : "Vĩnh viễn"}
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
                      <DropdownMenuItem>
                        <Link href={`/proxies/${proxy.id}`} className="flex items-center gap-2 w-full">
                          <Eye className="size-4" />
                          Xem chi tiết
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEdit(proxy)}>
                        <Pencil className="size-4" />
                        Sửa
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onHealthCheck([proxy.id])}>
                        <Activity className="size-4" />
                        Kiểm tra sống/chết
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onDelete(proxy.id)}
                      >
                        <Trash2 className="size-4" />
                        Xoá
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
