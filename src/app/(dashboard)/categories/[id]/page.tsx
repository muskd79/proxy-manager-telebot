"use client";

/**
 * Wave 27 PR-3a — /categories/[id] detail page (read mode).
 *
 * Lands here when admin clicks on a card in /categories. Shows:
 *   1. Header with name + visibility chip + edit / hide / delete /
 *      apply-defaults action buttons
 *   2. The same stock breakdown card the grid shows (single card,
 *      bigger, fully populated)
 *   3. Default values panel (giá trị mặc định cho proxy mới)
 *   4. List of proxies in this category (links to /proxies?category_id=X)
 *
 * Reuses card sub-components from PR-2 so the visual is consistent
 * with the grid.
 *
 * Owner: Wave 27 PR-3.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Pencil,
  Eye,
  EyeOff,
  Trash2,
  RefreshCw,
  Wand2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { CategoryFormDialog } from "@/components/categories/CategoryFormDialog";
import { StockProgressBar } from "@/components/categories/stock-progress-bar";
import { StatusBreakdownList } from "@/components/categories/status-breakdown-list";
import { CategoryRevenueBlock } from "@/components/categories/category-revenue-block";
import { CategoryDefaultsPanel } from "@/components/categories/category-defaults-panel";
import { ApplyDefaultsDialog } from "@/components/categories/apply-defaults-dialog";
import { visibilityChipTokens } from "@/lib/categories/colors";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/categories/formatters";
import type {
  CategoryDashboardRow,
  CategoryRow,
} from "@/lib/categories/types";

interface DetailResponse {
  success: boolean;
  data?: CategoryRow;
  error?: string;
}

interface DashboardResponse {
  success: boolean;
  data?: CategoryDashboardRow[];
}

export default function CategoryDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [category, setCategory] = useState<CategoryRow | null>(null);
  const [dashboardRow, setDashboardRow] = useState<CategoryDashboardRow | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [applyDefaultsOpen, setApplyDefaultsOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [detailRes, dashRes] = await Promise.all([
        fetch(`/api/categories/${id}`, { cache: "no-store" }),
        fetch(`/api/categories/dashboard`, { cache: "no-store" }),
      ]);
      const detailBody = (await detailRes.json()) as DetailResponse;
      const dashBody = (await dashRes.json()) as DashboardResponse;

      if (!detailRes.ok || !detailBody.success || !detailBody.data) {
        toast.error(detailBody.error ?? "Không tìm thấy danh mục");
        router.replace("/categories");
        return;
      }
      setCategory(detailBody.data);

      const dashRow =
        dashBody.success && dashBody.data
          ? dashBody.data.find((r) => r.id === id) ?? null
          : null;
      setDashboardRow(dashRow);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lỗi mạng");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggleHidden() {
    if (!category) return;
    try {
      const res = await fetch(`/api/categories/${category.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_hidden: !category.is_hidden }),
      });
      const body = await res.json();
      if (!body.success) {
        toast.error(body.error ?? "Đổi trạng thái thất bại");
        return;
      }
      toast.success(category.is_hidden ? "Đã hiện danh mục" : "Đã ẩn danh mục");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lỗi mạng");
    }
  }

  async function handleDelete() {
    if (!category) return;
    setDeleteSubmitting(true);
    try {
      const res = await fetch(`/api/categories/${category.id}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!body.success) {
        toast.error(body.error ?? "Xoá danh mục thất bại");
        return;
      }
      toast.success("Đã xoá danh mục — proxy đã chuyển về trạng thái không phân loại");
      router.replace("/categories");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lỗi mạng");
    } finally {
      setDeleteSubmitting(false);
      setDeleteOpen(false);
    }
  }

  const visibilityTokens = useMemo(
    () => (category ? visibilityChipTokens(category) : null),
    [category],
  );

  if (loading || !category) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link
            href="/categories"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Quay lại danh mục
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {category.name}
            </h1>
            {visibilityTokens && (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                  visibilityTokens.bg,
                  visibilityTokens.text,
                  visibilityTokens.ring,
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    visibilityTokens.dot,
                  )}
                />
                {visibilityTokens.label}
              </span>
            )}
            <span className="text-sm text-muted-foreground">
              {formatCount(dashboardRow?.proxy_count ?? category.proxy_count)} proxy
            </span>
          </div>
          {category.description && (
            <p className="text-sm text-muted-foreground max-w-2xl">
              {category.description}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setApplyDefaultsOpen(true)}
            className="min-h-11"
          >
            <Wand2 className="size-4" />
            Áp dụng mặc định
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleHidden}
            className="min-h-11"
            aria-label={category.is_hidden ? "Hiện danh mục" : "Ẩn danh mục"}
          >
            {category.is_hidden ? (
              <Eye className="size-4" />
            ) : (
              <EyeOff className="size-4" />
            )}
            {category.is_hidden ? "Hiện" : "Ẩn"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
            className="min-h-11"
          >
            <Pencil className="size-4" />
            Sửa
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            className="min-h-11 text-destructive hover:text-destructive"
            aria-label="Xoá danh mục"
          >
            <Trash2 className="size-4" />
            Xoá
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="min-h-11"
            aria-label="Làm mới"
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>

      {/* Two-column body: stats card (left) + defaults panel (right) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Stats card — reuses the same components as the grid card for visual parity */}
        <section
          className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-4 space-y-3"
          aria-label="Tổng quan tồn kho"
        >
          <h2 className="text-sm font-semibold text-slate-200">
            Tổng quan tồn kho
          </h2>
          {dashboardRow ? (
            <>
              <StockProgressBar row={dashboardRow} />
              <StatusBreakdownList row={dashboardRow} showZero />
              <CategoryRevenueBlock row={dashboardRow} />
            </>
          ) : (
            <p className="text-xs text-slate-500">
              Chưa có dữ liệu thống kê — RPC dashboard chưa trả về danh mục
              này.
            </p>
          )}
        </section>

        {/* Defaults panel — what gets prefilled when admin adds a proxy here */}
        <CategoryDefaultsPanel category={category} />
      </div>

      {/* Quick action: open filtered /proxies list */}
      <Link
        href={`/proxies?category_id=${category.id}`}
        className="inline-flex items-center gap-2 text-sm text-orange-400 hover:text-orange-300"
      >
        <ExternalLink className="size-4" />
        Xem danh sách proxy của danh mục này
      </Link>

      {/* Dialogs */}
      <CategoryFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        category={category}
        onSaved={() => {
          void load();
        }}
      />
      <ApplyDefaultsDialog
        open={applyDefaultsOpen}
        onOpenChange={setApplyDefaultsOpen}
        categoryId={category.id}
        categoryName={category.name}
        onApplied={() => {
          void load();
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        variant="destructive"
        title="Xoá danh mục?"
        description={`Danh mục "${category.name}" sẽ bị xoá. ${
          (dashboardRow?.proxy_count ?? category.proxy_count) > 0
            ? `${formatCount(dashboardRow?.proxy_count ?? category.proxy_count)} proxy thuộc danh mục này sẽ chuyển về trạng thái KHÔNG PHÂN LOẠI (không xoá proxy).`
            : "Không có proxy nào thuộc danh mục này."
        }`}
        confirmText={deleteSubmitting ? "Đang xoá..." : "Xoá danh mục"}
        cancelText="Huỷ"
        onConfirm={handleDelete}
      />
    </div>
  );
}
