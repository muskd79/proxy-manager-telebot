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
import { CredentialCell } from "@/components/proxies/credential-cell";

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

// Wave 22N — typeColors rebuilt for WCAG AA contrast.
// Pre-fix used `bg-{color}-500/10 text-{color}-500` which gave ~1.5:1
// contrast against the muted bg — well below the 4.5:1 AA floor for
// small text. Replaced with the {100 bg / 900 text} light pair and
// {900/40 bg / 100 text} dark pair, both verified ≥4.5:1.
const typeColors: Record<string, string> = {
  http: "bg-cyan-100 text-cyan-900 border-cyan-300 dark:bg-cyan-900/40 dark:text-cyan-100 dark:border-cyan-700",
  https: "bg-green-100 text-green-900 border-green-300 dark:bg-green-900/40 dark:text-green-100 dark:border-green-700",
  socks5: "bg-purple-100 text-purple-900 border-purple-300 dark:bg-purple-900/40 dark:text-purple-100 dark:border-purple-700",
};

// Wave 26-B (gap 4.1) — colspan source-of-truth. Pre-fix the empty-
// state TableCell hardcoded `colSpan={14}`; if a column is added or
// removed the empty state renders misaligned. Now: count from a const
// and a TODO to update both header + colSpan together.
const DESKTOP_COLUMN_COUNT = 14;

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
          aria-label={`Sắp xếp theo ${typeof children === "string" ? children : column}`}
          className="flex items-center gap-1 hover:text-foreground transition-colors min-h-11"
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
    <>
      {/* Wave 22N — Mobile card view (<768px). The 11-col table is unusable
          on mobile; cards show host:port, protocol badge, status badges and
          the same dropdown actions. */}
      <div className="md:hidden space-y-2" role="list" aria-label="Danh sách proxy">
        {proxies.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">Chưa có proxy nào</p>
        ) : (
          proxies.map((proxy) => {
            const statusList = proxyStatusBadges(proxy);
            const selected = selectedIds.includes(proxy.id);
            return (
              <div
                key={proxy.id}
                role="listitem"
                className={`rounded-lg border p-3 ${selected ? "bg-muted/50 border-primary/40" : "bg-card"}`}
              >
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={selected}
                    onCheckedChange={() => toggleOne(proxy.id)}
                    aria-label={`Chọn proxy ${proxy.host}:${proxy.port}`}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/proxies/${proxy.id}`}
                      className="font-mono text-sm font-medium hover:underline break-all"
                    >
                      {proxy.host}:{proxy.port}
                    </Link>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${typeColors[proxy.type] || ""}`}
                      >
                        {TYPE_LABEL[proxy.type] ?? proxy.type.toUpperCase()}
                      </span>
                      {proxy.network_type && (
                        <Badge variant="outline" className="text-xs">
                          {networkTypeLabel(proxy.network_type as NetworkType)}
                        </Badge>
                      )}
                      {statusList.slice(0, 3).map((b, i) => (
                        <Badge
                          key={`${b.label}-${i}`}
                          variant={b.variant}
                          className={`text-xs ${b.tone === "muted" ? "opacity-70" : ""}`}
                        >
                          {b.label}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-x-3">
                      {proxy.country && <span>{proxy.country}</span>}
                      {proxy.speed_ms != null && <span>{proxy.speed_ms}ms</span>}
                      {proxy.expires_at && (
                        <span>
                          HSD: {new Date(proxy.expires_at).toLocaleDateString("vi-VN")}
                        </span>
                      )}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Mở menu thao tác cho proxy ${proxy.host}:${proxy.port}`}
                          className="min-h-11 min-w-11"
                        >
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
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop / tablet table (≥768px). Wrapped in overflow-x-auto so
          11 cols stay scrollable on narrow tablet widths without breaking
          the layout. */}
      <div className="relative w-full overflow-x-auto hidden md:block">
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
          <TableHead>Username</TableHead>
          <TableHead>Mật khẩu</TableHead>
          <SortableHead column="type">Giao thức</SortableHead>
          {/* Wave 22AB — column renamed Phân loại → Loại mạng */}
          <TableHead>Loại mạng</TableHead>
          <TableHead>Trạng thái</TableHead>
          <SortableHead column="country">Quốc gia</SortableHead>
          {/* Wave 22Y — ISP column removed (per user); column hidden from UI but
              field still present in API/DB for backward-compat with prior imports. */}
          <TableHead>Người dùng</TableHead>
          <SortableHead column="assigned_at">Thời gian giao</SortableHead>
          <SortableHead column="speed_ms">Tốc độ</SortableHead>
          <SortableHead column="expires_at">Ngày hết hạn</SortableHead>
          <SortableHead column="created_by">Người thêm</SortableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {proxies.length === 0 ? (
          <TableRow>
            <TableCell colSpan={DESKTOP_COLUMN_COUNT} className="text-center py-8">
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
                    aria-label={`Chọn proxy ${proxy.host}:${proxy.port}`}
                  />
                </TableCell>
                <TableCell className="font-mono text-sm">
                  <Link href={`/proxies/${proxy.id}`} className="hover:underline">
                    {proxy.host}:{proxy.port}
                  </Link>
                </TableCell>
                {/* Wave 22W — username + masked password with click-to-reveal */}
                <TableCell>
                  <CredentialCell value={proxy.username} kind="username" />
                </TableCell>
                <TableCell>
                  <CredentialCell value={proxy.password} kind="password" />
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
                {/* Wave 22Y — ISP cell removed */}
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
                {/* Wave 22S — Thời gian giao */}
                <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                  {proxy.assigned_at
                    ? new Date(proxy.assigned_at).toLocaleString("vi-VN", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "-"}
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
                {/* Wave 22S — Người thêm (admin who created the proxy) */}
                <TableCell className="text-muted-foreground text-xs">
                  {proxy.created_by ? (
                    <span className="font-mono">{proxy.created_by.slice(0, 8)}…</span>
                  ) : (
                    <span>—</span>
                  )}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Mở menu thao tác cho proxy ${proxy.host}:${proxy.port}`}
                          className="min-h-11 min-w-11"
                        >
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
      </div>
    </>
  );
}
