"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { CategoryFormDialog } from "@/components/categories/CategoryFormDialog";
import { ProxySubTabs } from "@/components/proxies/proxy-sub-tabs";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { ProxyCategory } from "@/types/database";

/**
 * /categories — admin page for proxy_categories CRUD.
 *
 * Wave 22B (this file): list + create + edit + delete + toggle hidden +
 * up/down reorder buttons (uses POST /api/categories/reorder atomically).
 * Drag-and-drop is deferred — manual up/down covers ~95% of admin needs
 * and avoids pulling @dnd-kit into the bundle for v1.
 *
 * Cascade-on-delete preview: clicking Delete shows the proxy_count and
 * warns the admin that proxies in this category will become uncategorised
 * (FK ON DELETE SET NULL).
 */
export default function CategoriesPage() {
  const [rows, setRows] = useState<ProxyCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeHidden, setIncludeHidden] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProxyCategory | null>(null);

  const [deleting, setDeleting] = useState<ProxyCategory | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = includeHidden ? "/api/categories?include_hidden=1" : "/api/categories";
      const res = await fetch(url, { cache: "no-store" });
      const body = await res.json();
      if (!body.success) {
        toast.error(body.error ?? "Failed to load categories");
        return;
      }
      setRows(body.data as ProxyCategory[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [includeHidden]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Move a category one slot up or down.
   *
   * Wave 22E-5 BUG FIX (A2): pre-fix sent `[b.sort_order, a.sort_order]`
   * — a literal swap of values. When two rows shared the same sort_order
   * (very common: defaults to 0 on create), swapping identical values
   * was a no-op and the user clicked the arrow with no visible change.
   * Fix: rebuild the entire ordering with absolute positions (0, 1, 2,
   * ..., N-1) and send the new positions for the swapped pair plus any
   * other duplicates. This guarantees the swap always produces distinct
   * sort_order values.
   */
  async function move(category: ProxyCategory, direction: -1 | 1) {
    const idx = rows.findIndex((r) => r.id === category.id);
    if (idx < 0) return;
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= rows.length) return;

    // Build a normalised ordering: every visible row gets a unique
    // sort_order matching its display position (0, 1, 2, ...). Then
    // perform the in-array swap to compute the new ordering.
    const reordered = rows.map((r) => r.id);
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];

    try {
      const res = await fetch("/api/categories/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids: reordered,
          sort_orders: reordered.map((_, i) => i),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error ?? "Reorder failed");
        return;
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reorder failed");
    }
  }

  async function toggleHidden(c: ProxyCategory) {
    try {
      const res = await fetch(`/api/categories/${c.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_hidden: !c.is_hidden }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error ?? "Failed to toggle visibility");
        return;
      }
      toast.success(c.is_hidden ? "Category visible" : "Category hidden");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteSubmitting(true);
    try {
      const res = await fetch(`/api/categories/${deleting.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error ?? "Failed to delete");
        return;
      }
      toast.success("Category deleted");
      setDeleting(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setDeleteSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Wave 22T — sub-tab of Quản lý proxy. */}
      <ProxySubTabs />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Danh mục</h1>
          <p className="text-sm text-muted-foreground">
            Quản lý gom nhóm proxy theo nguồn / quốc gia / loại / giá.
            Mỗi danh mục có tham số mặc định (loại, quốc gia, giá, ISP)
            để prefill khi thêm proxy mới. Toggle ẩn ở đây sẽ ẩn toàn
            bộ proxy thuộc danh mục.
          </p>
        </div>
        <div className="flex gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeHidden}
              onChange={(e) => setIncludeHidden(e.target.checked)}
            />
            Include hidden
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            aria-label="Làm mới danh mục"
            className="min-h-11"
          >
            <RefreshCw className={loading ? "animate-spin" : undefined} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus />
            New category
          </Button>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState onCreate={() => setFormOpen(true)} />
      ) : (
        <div className="rounded-lg border relative w-full overflow-x-auto">
          <Table aria-label="Danh sách danh mục">
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Order</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Color</TableHead>
                <TableHead>Proxies</TableHead>
                <TableHead>Default $</TableHead>
                <TableHead>Min stock</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c, i) => (
                <TableRow key={c.id} className={c.is_hidden ? "opacity-60" : undefined}>
                  <TableCell>
                    <div className="flex flex-col">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => move(c, -1)}
                        disabled={i === 0}
                        aria-label={`Di chuyển danh mục ${c.name} lên trên`}
                        className="min-h-11 min-w-11"
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => move(c, 1)}
                        disabled={i === rows.length - 1}
                        aria-label={`Di chuyển danh mục ${c.name} xuống dưới`}
                        className="min-h-11 min-w-11"
                      >
                        <ArrowDown />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className="size-3 rounded-full"
                        style={{ backgroundColor: cssColorFor(c.color) }}
                      />
                      <Link
                        href={`/proxies?category_id=${c.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {c.name}
                      </Link>
                      {c.is_hidden && <Badge variant="secondary">hidden</Badge>}
                    </div>
                    {c.description && (
                      <div className="text-xs text-muted-foreground line-clamp-1">
                        {c.description}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{c.color}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{c.proxy_count}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {c.default_price_usd != null ? `$${c.default_price_usd.toFixed(4)}` : "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {c.min_stock_alert > 0 ? c.min_stock_alert : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleHidden(c)}
                        title={c.is_hidden ? "Show" : "Hide"}
                        aria-label={c.is_hidden ? `Hiện danh mục ${c.name}` : `Ẩn danh mục ${c.name}`}
                        className="min-h-11 min-w-11"
                      >
                        {c.is_hidden ? <Eye /> : <EyeOff />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditing(c);
                          setFormOpen(true);
                        }}
                        title="Edit"
                        aria-label={`Sửa danh mục ${c.name}`}
                        className="min-h-11 min-w-11"
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleting(c)}
                        title="Delete"
                        aria-label={`Xoá danh mục ${c.name}`}
                        className="min-h-11 min-w-11"
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CategoryFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        category={editing}
        onSaved={load}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete category?"
        description={
          deleting
            ? `${deleting.name} contains ${deleting.proxy_count} proxies. They will become uncategorised (not deleted). This cannot be undone.`
            : ""
        }
        confirmText="Delete category"
        cancelText="Cancel"
        variant="destructive"
        loading={deleteSubmitting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <h3 className="text-lg font-semibold">Chưa có danh mục nào</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Tạo danh mục để gom nhóm proxy theo nguồn (&quot;Proxy-Seller US
        Residential&quot;), mục đích (&quot;Premium&quot;), hoặc bất kỳ trục
        nào hữu ích cho bulk operations.
      </p>
      <Button className="mt-3" onClick={onCreate}>
        <Plus />
        Tạo danh mục đầu tiên
      </Button>
    </div>
  );
}

function cssColorFor(name: string): string {
  const map: Record<string, string> = {
    purple: "#a855f7",
    blue: "#3b82f6",
    green: "#22c55e",
    yellow: "#eab308",
    red: "#ef4444",
    pink: "#ec4899",
    indigo: "#6366f1",
    gray: "#6b7280",
  };
  return map[name] ?? "#a855f7";
}
