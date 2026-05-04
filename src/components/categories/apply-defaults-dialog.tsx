"use client";

/**
 * Wave 27 PR-3c — "Apply defaults retroactively" dialog.
 *
 * Two-mode operation per brainstormer #7 (architect's single-button
 * was useless when admin had non-null fields):
 *   - "only_null" (default, safe) — fill blank fields only, never
 *     overwrite admin's manual edits
 *   - "force" — overwrite EVERY proxy in the category
 *     (destructive — requires extra confirm)
 *
 * Both modes audit to activity_logs via the SQL RPC. The dialog
 * surfaces the `affected` count back to the user via toast.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Wand2, AlertTriangle, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CategoryApplyMode } from "@/lib/categories/types";

interface ApplyDefaultsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryId: string;
  categoryName: string;
  /** Fired after a successful apply (with affected count > 0 OR not). */
  onApplied: (affected: number) => void;
}

interface ApplyDefaultsResponse {
  success: boolean;
  data?: { affected: number; mode: string };
  message?: string;
  error?: string;
}

export function ApplyDefaultsDialog({
  open,
  onOpenChange,
  categoryId,
  categoryName,
  onApplied,
}: ApplyDefaultsDialogProps) {
  const [mode, setMode] = useState<CategoryApplyMode>("only_null");
  const [submitting, setSubmitting] = useState(false);
  const [forceConfirmed, setForceConfirmed] = useState(false);

  function handleClose() {
    if (submitting) return;
    onOpenChange(false);
    // Reset state on close — safe defaults next time.
    setMode("only_null");
    setForceConfirmed(false);
  }

  async function handleSubmit() {
    if (mode === "force" && !forceConfirmed) {
      toast.error("Vui lòng xác nhận chế độ ghi đè trước khi tiếp tục");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/categories/${categoryId}/apply-defaults`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode }),
        },
      );
      const body = (await res.json()) as ApplyDefaultsResponse;
      if (!res.ok || !body.success) {
        toast.error(body.error ?? "Áp dụng thất bại");
        return;
      }
      const affected = body.data?.affected ?? 0;
      toast.success(
        body.message ??
          (mode === "only_null"
            ? `Đã điền giá trị mặc định cho ${affected} proxy chưa có giá trị.`
            : `Đã ghi đè giá trị mặc định cho ${affected} proxy.`),
      );
      onApplied(affected);
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lỗi mạng");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="size-5 text-orange-400" />
            Áp dụng giá trị mặc định
          </DialogTitle>
          <DialogDescription>
            Áp dụng các giá trị mặc định của danh mục{" "}
            <span className="font-semibold">{categoryName}</span> cho các proxy
            đã có sẵn trong danh mục.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Option 1: only_null — safe */}
          <button
            type="button"
            onClick={() => {
              setMode("only_null");
              setForceConfirmed(false);
            }}
            className={cn(
              "w-full rounded-lg border p-3 text-left transition-colors",
              mode === "only_null"
                ? "border-emerald-500/50 bg-emerald-500/5"
                : "border-slate-700/60 bg-slate-900/40 hover:border-slate-600",
            )}
          >
            <div className="flex items-start gap-3">
              <ShieldCheck
                className={cn(
                  "mt-0.5 size-5 shrink-0",
                  mode === "only_null" ? "text-emerald-400" : "text-slate-500",
                )}
              />
              <div className="space-y-1">
                <div className="text-sm font-semibold text-slate-100">
                  Điền các trường còn trống (an toàn)
                </div>
                <p className="text-xs text-slate-400">
                  Chỉ điền vào những proxy có trường đang trống/null. Những
                  proxy đã có giá trị (do admin tự nhập) sẽ KHÔNG bị thay đổi.
                  Đề xuất cho hầu hết trường hợp.
                </p>
              </div>
            </div>
          </button>

          {/* Option 2: force — destructive */}
          <button
            type="button"
            onClick={() => setMode("force")}
            className={cn(
              "w-full rounded-lg border p-3 text-left transition-colors",
              mode === "force"
                ? "border-red-500/50 bg-red-500/5"
                : "border-slate-700/60 bg-slate-900/40 hover:border-slate-600",
            )}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle
                className={cn(
                  "mt-0.5 size-5 shrink-0",
                  mode === "force" ? "text-red-400" : "text-slate-500",
                )}
              />
              <div className="space-y-1">
                <div className="text-sm font-semibold text-slate-100">
                  Ghi đè TẤT CẢ proxy (không thể hoàn tác)
                </div>
                <p className="text-xs text-slate-400">
                  Mọi proxy trong danh mục sẽ được cập nhật với giá trị mặc
                  định mới — kể cả những proxy admin đã chỉnh tay. Dùng khi
                  muốn đồng bộ toàn bộ.
                </p>
              </div>
            </div>
          </button>

          {/* Force-mode confirmation */}
          {mode === "force" && (
            <label className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/5 p-3">
              <input
                type="checkbox"
                checked={forceConfirmed}
                onChange={(e) => setForceConfirmed(e.target.checked)}
                className="mt-0.5 size-4 rounded border-red-500/40"
              />
              <span className="text-xs text-red-200">
                Tôi hiểu thao tác này sẽ ghi đè dữ liệu hiện có và không thể
                hoàn tác. Hành động sẽ được ghi vào lịch sử (activity_logs).
              </span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            Huỷ
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || (mode === "force" && !forceConfirmed)}
            variant={mode === "force" ? "destructive" : "default"}
          >
            {submitting
              ? "Đang áp dụng..."
              : mode === "only_null"
                ? "Áp dụng (an toàn)"
                : "Ghi đè TẤT CẢ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
