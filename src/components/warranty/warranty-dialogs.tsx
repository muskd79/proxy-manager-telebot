"use client";

/**
 * Wave 26-D-2 — warranty approve + reject dialogs.
 *
 * Approve dialog (A7=b): checkbox "đồng thời mark banned" defaulted
 * OFF. When ticked, original proxy goes straight to banned instead of
 * maintenance — admin signal that they're confident the proxy is dead.
 *
 * Reject dialog: requires admin to enter rejection_reason (server-side
 * CHECK constraint enforces non-empty rejection_reason when status=rejected).
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import type { WarrantyClaimRow } from "./warranty-table";

interface ApproveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claim: WarrantyClaimRow | null;
  onApproved: () => void;
}

export function ApproveWarrantyDialog({
  open,
  onOpenChange,
  claim,
  onApproved,
}: ApproveDialogProps) {
  const [alsoMarkBanned, setAlsoMarkBanned] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Reset checkbox when opening for a new claim.
  function reset() {
    setAlsoMarkBanned(false);
  }

  async function handleApprove() {
    if (!claim) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/warranty/${claim.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          also_mark_banned: alsoMarkBanned,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        const msg =
          body?.message || body?.error || "Duyệt warranty thất bại";
        toast.error(msg);
        return;
      }
      const tier = body.data?.allocator_tier as 1 | 2 | 3 | null;
      const replacement = body.data?.replacement as
        | { host: string; port: number }
        | null;
      const tierLabel =
        tier === 1
          ? "cùng category + loại mạng"
          : tier === 2
            ? "cùng category"
            : tier === 3
              ? "bất kỳ proxy"
              : null;
      toast.success(
        replacement
          ? `Đã duyệt warranty — cấp ${replacement.host}:${replacement.port}${tierLabel ? ` (${tierLabel})` : ""}`
          : "Đã duyệt warranty",
        { duration: 8000 },
      );
      reset();
      onOpenChange(false);
      onApproved();
    } catch (err) {
      console.error("Failed to approve warranty:", err);
      toast.error("Duyệt warranty thất bại");
    } finally {
      setSubmitting(false);
    }
  }

  if (!claim) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-emerald-600" aria-hidden="true" />
            Duyệt yêu cầu bảo hành
          </DialogTitle>
          <DialogDescription>
            Hệ thống sẽ tự cấp proxy thay thế cho user, copy hạn dùng còn
            lại từ proxy gốc, và cập nhật lịch sử proxy.
          </DialogDescription>
        </DialogHeader>

        {/* Claim summary */}
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
          {claim.proxy && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Proxy:</span>
              <code className="font-mono">
                {claim.proxy.host}:{claim.proxy.port}
              </code>
              <Badge variant="outline" className="text-xs uppercase">
                {claim.proxy.type}
              </Badge>
            </div>
          )}
          {claim.user && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">User:</span>
              <span>
                {claim.user.username
                  ? `@${claim.user.username}`
                  : claim.user.first_name ?? claim.user.telegram_id}
              </span>
            </div>
          )}
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground">Lý do:</span>
            <div className="flex-1">
              <Badge variant="outline" className="text-xs">
                {claim.reason_code}
              </Badge>
              {claim.reason_text && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {claim.reason_text}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* A7=b — checkbox */}
        <label
          htmlFor="also-mark-banned"
          className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/30"
        >
          <Checkbox
            id="also-mark-banned"
            checked={alsoMarkBanned}
            onCheckedChange={(v) => setAlsoMarkBanned(v === true)}
            disabled={submitting}
          />
          <div className="flex-1">
            <p className="text-sm font-medium">
              Đồng thời đánh dấu proxy gốc là <span className="text-destructive">Banned</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Mặc định proxy gốc chuyển sang <span className="font-medium">Bảo trì</span>{" "}
              (admin có thể test lại để khôi phục). Tick ô này nếu bạn xác nhận
              proxy hỏng vĩnh viễn — sẽ chuyển thẳng <span className="font-medium">Banned</span>.
            </p>
          </div>
        </label>

        {/* Allocator preview hint */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
          <p className="font-medium">Allocator sẽ tìm proxy thay thế theo 3 tier:</p>
          <ol className="mt-1 ml-4 list-decimal space-y-0.5">
            <li>Cùng category + cùng loại mạng</li>
            <li>Cùng category (any loại mạng)</li>
            <li>Bất kỳ proxy nào available</li>
          </ol>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Huỷ
          </Button>
          <Button onClick={handleApprove} disabled={submitting}>
            {submitting ? "Đang xử lý..." : "Duyệt warranty"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RejectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claim: WarrantyClaimRow | null;
  onRejected: () => void;
}

export function RejectWarrantyDialog({
  open,
  onOpenChange,
  claim,
  onRejected,
}: RejectDialogProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setReason("");
  }

  async function handleReject() {
    if (!claim) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error("Vui lòng nhập lý do từ chối");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/warranty/${claim.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", rejection_reason: trimmed }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        const msg = body?.message || body?.error || "Từ chối warranty thất bại";
        toast.error(msg);
        return;
      }
      toast.success("Đã từ chối warranty — proxy gốc khôi phục về Đã giao");
      reset();
      onOpenChange(false);
      onRejected();
    } catch (err) {
      console.error("Failed to reject warranty:", err);
      toast.error("Từ chối warranty thất bại");
    } finally {
      setSubmitting(false);
    }
  }

  if (!claim) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="size-5 text-destructive" aria-hidden="true" />
            Từ chối yêu cầu bảo hành
          </DialogTitle>
          <DialogDescription>
            Lý do từ chối sẽ được gửi cho user qua bot Telegram. Proxy gốc
            sẽ được trả về trạng thái <span className="font-medium">Đã giao</span> (user
            tiếp tục dùng proxy đó).
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              Quyết định từ chối là cuối cùng — user không có flow khiếu nại.
              Hãy nhập lý do rõ ràng để user hiểu.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="rejection-reason">
            Lý do từ chối <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="rejection-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Vd: Đã test proxy thấy hoạt động bình thường, có thể do mạng phía user. Vui lòng thử kết nối lại."
            rows={4}
            maxLength={2000}
            className="resize-none"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            {reason.length}/2000 ký tự
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Huỷ
          </Button>
          <Button
            variant="destructive"
            onClick={handleReject}
            disabled={submitting || !reason.trim()}
          >
            {submitting ? "Đang xử lý..." : "Từ chối warranty"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
