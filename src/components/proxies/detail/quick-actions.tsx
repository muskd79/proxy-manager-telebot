"use client";

/**
 * Wave 26-D-pre1 (gap D3, synthesis from multi-agent brainstorm 2026-05-03).
 *
 * State-contextual quick-actions bar for the proxy detail header.
 *
 * Pre-fix the page had a static row of 5 buttons (Edit / Health Check /
 * Delete + nothing else) — admin couldn't toggle hidden, force expire,
 * mark banned, or unassign without going to bulk-edit. The first
 * brainstorm draft mushroomed to "all 5 + 7 from D3 = 12 buttons", which
 * the brainstormer agent shut down: too many destructive actions in one
 * row trains finger-memory mistakes.
 *
 * Final decision: split actions by status of the proxy. Only buttons
 * RELEVANT to the current state are surfaced as primary; the rest live
 * inside a `⋯` overflow menu. Every destructive action requires a
 * confirmation dialog with reason input — the reason flows into
 * `proxy_events.details.reason` (Wave 26-D ships proxy_events; pre1
 * stores it in activity_logs.details.reason via existing PATCH handler).
 *
 * State machine awareness:
 *   - `available` → primary "Cấp thủ công" (placeholder until Wave 26-D
 *     adds the manual-assign flow), "Sửa". Overflow: Ẩn, Sao chép URL,
 *     Mark banned (with reason).
 *   - `assigned` → primary "Thu hồi" (with reason), "Sửa". Overflow:
 *     Ẩn, Sao chép, Force expire, Mark banned.
 *   - `reported_broken` (Wave 26-D enum) → primary "Duyệt bảo hành →"
 *     (deep-link /warranty?proxy_id=…), "Từ chối bảo hành". This Wave
 *     26-D-pre1 commit prepares the UI but the action no-ops until the
 *     enum lands.
 *   - `banned` → primary "Khôi phục" (banned → maintenance), "Sửa".
 *     Overflow: Sao chép, "Clone as new proxy" (Wave 26-D), Soft-delete.
 *   - `expired` → primary "Cấp lại" (re-enable), "Sửa". Overflow:
 *     Sao chép, Soft-delete.
 *   - `maintenance` → primary "Đưa về sẵn sàng", "Sửa".
 *   - is_deleted=true → primary "Khôi phục từ thùng rác". Overflow: none.
 *
 * Wave 26-D-pre1 ships with the layout + dispatcher; some actions
 * (manual assign, clone-as-new, warranty deep links) are left as
 * disabled buttons with tooltip "Sẽ có ở Wave 26-D" so admins see the
 * shape early.
 *
 * Accessibility:
 *   - Primary buttons are real <Button>s, keyboard reachable.
 *   - Overflow uses shadcn DropdownMenu, ARIA role=menu provided.
 *   - Destructive actions use ConfirmDialog (already keyboard accessible).
 */

import { useState } from "react";
import {
  MoreHorizontal,
  Pencil,
  EyeOff,
  Eye,
  Activity,
  UserMinus,
  ShieldOff,
  Ban,
  RotateCcw,
  Copy,
  Trash2,
  Sparkles,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import type { Proxy } from "@/types/database";

interface QuickActionsProps {
  proxy: Proxy;
  canWrite: boolean;
  /** Open the Sửa proxy dialog. */
  onEdit: () => void;
  /** Run a manual health check on this proxy. */
  onHealthCheck: () => Promise<void> | void;
  /** Toggle the `hidden` flag. Resolves on success. */
  onToggleHidden: (next: boolean) => Promise<void>;
  /** Soft-delete (move to trash). */
  onSoftDelete: () => Promise<void>;
  /** Set proxy.status with structured reason. The reason is logged in
   * activity_logs.details.reason and (Wave 26-D) in proxy_events. */
  onSetStatus: (
    next: Proxy["status"],
    reason: string | null,
  ) => Promise<void>;
  /** Manually unassign the current user (proxy goes status=available). */
  onUnassign: (reason: string | null) => Promise<void>;
  /** Restore from trash. */
  onRestoreFromTrash: () => Promise<void>;
}

interface ReasonDialogState {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
  onConfirm: (reason: string) => Promise<void>;
  /** Optional placeholder hint for the textarea. */
  placeholder?: string;
  /** Optional pre-fill (e.g., "Đã được vendor confirm hỏng"). */
  defaultReason?: string;
  /** When true, reason is required; when false, empty allowed. */
  reasonRequired: boolean;
}

/**
 * Wave 26-D-pre1 — reason-input ConfirmDialog. Specialised because
 * shadcn ConfirmDialog doesn't support a textarea body. This component
 * is internal to QuickActions for now; if other surfaces need it, we
 * extract to src/components/shared/.
 */
function ReasonDialog({
  state,
  onClose,
}: {
  state: ReasonDialogState;
  onClose: () => void;
}) {
  const [reason, setReason] = useState(state.defaultReason ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    const trimmed = reason.trim();
    if (state.reasonRequired && !trimmed) {
      toast.error("Vui lòng nhập lý do");
      return;
    }
    setSubmitting(true);
    try {
      await state.onConfirm(trimmed);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state.title}</DialogTitle>
          <DialogDescription>{state.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reason-input">
            Lý do{state.reasonRequired && <span className="text-destructive ml-0.5">*</span>}
          </Label>
          <Textarea
            id="reason-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={state.placeholder ?? "Nhập lý do để ghi vào lịch sử proxy..."}
            rows={3}
            maxLength={500}
            className="resize-none"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            Lý do được lưu vào lịch sử và không thể chỉnh sửa sau.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Huỷ
          </Button>
          <Button
            variant={state.destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting ? "Đang xử lý..." : state.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function QuickActions({
  proxy,
  canWrite,
  onEdit,
  onHealthCheck,
  onToggleHidden,
  onSoftDelete,
  onSetStatus,
  onUnassign,
  onRestoreFromTrash,
}: QuickActionsProps) {
  const [reasonState, setReasonState] = useState<ReasonDialogState | null>(null);
  const [softDeleteOpen, setSoftDeleteOpen] = useState(false);
  const [healthChecking, setHealthChecking] = useState(false);

  // ─── Helpers ───────────────────────────────────────────────────────
  function handleCopy() {
    const str = proxy.username && proxy.password
      ? `${proxy.host}:${proxy.port}:${proxy.username}:${proxy.password}`
      : `${proxy.host}:${proxy.port}`;
    void navigator.clipboard.writeText(str);
    toast.success("Đã chép proxy");
  }

  async function handleHealthCheck() {
    setHealthChecking(true);
    try {
      await onHealthCheck();
      toast.success("Đã kiểm tra proxy");
    } catch {
      toast.error("Kiểm tra thất bại");
    } finally {
      setHealthChecking(false);
    }
  }

  function openReason(s: Omit<ReasonDialogState, "open">) {
    setReasonState({ ...s, open: true });
  }

  function closeReason() {
    setReasonState(null);
  }

  // ─── Action handlers ───────────────────────────────────────────────
  function handleUnassign() {
    openReason({
      title: "Thu hồi proxy?",
      description: `Proxy ${proxy.host}:${proxy.port} sẽ bị thu hồi khỏi user đang dùng. User sẽ mất quyền truy cập ngay.`,
      confirmLabel: "Thu hồi",
      destructive: true,
      reasonRequired: true,
      placeholder: "Vd: User báo lỗi, vendor refund, …",
      onConfirm: async (reason) => {
        await onUnassign(reason);
        toast.success("Đã thu hồi proxy");
      },
    });
  }

  function handleMarkBanned() {
    openReason({
      title: "Đánh dấu proxy là Báo lỗi?",
      description: `${proxy.host}:${proxy.port} sẽ chuyển sang trạng thái "Báo lỗi" và không cấp lại được nữa cho đến khi khôi phục thủ công.`,
      confirmLabel: "Đánh dấu Báo lỗi",
      destructive: true,
      reasonRequired: true,
      placeholder: "Vd: Vendor confirm hỏng, IP bị block target, …",
      onConfirm: async (reason) => {
        await onSetStatus("banned", reason);
        toast.success("Đã đánh dấu Báo lỗi");
      },
    });
  }

  function handleForceExpire() {
    openReason({
      title: "Hết hạn proxy ngay?",
      description: `${proxy.host}:${proxy.port} sẽ chuyển sang trạng thái "Hết hạn" ngay lập tức. Cron expire sẽ bỏ qua proxy này.`,
      confirmLabel: "Hết hạn ngay",
      destructive: true,
      reasonRequired: false,
      placeholder: "Tuỳ chọn — vd: vendor đã thu hồi gói…",
      onConfirm: async (reason) => {
        await onSetStatus("expired", reason || null);
        toast.success("Đã đánh dấu hết hạn");
      },
    });
  }

  function handleRestoreFromBanned() {
    openReason({
      title: "Khôi phục proxy?",
      description: `${proxy.host}:${proxy.port} đang ở trạng thái Báo lỗi. Khôi phục sẽ chuyển proxy về Bảo trì để admin test lại trước khi cấp.`,
      confirmLabel: "Khôi phục về Bảo trì",
      destructive: false,
      reasonRequired: false,
      placeholder: "Tuỳ chọn — vd: vendor đã fix, đã test pass thủ công…",
      onConfirm: async (reason) => {
        await onSetStatus("maintenance", reason || null);
        toast.success("Đã khôi phục về Bảo trì");
      },
    });
  }

  function handleMaintenanceToAvailable() {
    openReason({
      title: "Đưa proxy về Sẵn sàng?",
      description: `${proxy.host}:${proxy.port} sẽ chuyển từ Bảo trì sang Sẵn sàng và có thể được cấp lại cho user.`,
      confirmLabel: "Đưa về Sẵn sàng",
      destructive: false,
      reasonRequired: false,
      placeholder: "Tuỳ chọn — vd: đã test pass 3 lần…",
      onConfirm: async (reason) => {
        await onSetStatus("available", reason || null);
        toast.success("Proxy đã sẵn sàng cấp lại");
      },
    });
  }

  /**
   * Wave 26-D bug hunt v2 [HIGH] — pre-fix the "Cấp lại" button on
   * expired proxies reused handleMaintenanceToAvailable, so admin saw
   * the wrong dialog copy ("sẽ chuyển từ Bảo trì sang Sẵn sàng") even
   * though the proxy was Hết hạn. Now: dedicated handler with copy
   * that names the actual transition (Hết hạn → Sẵn sàng) and prompts
   * for the renewal context (vendor extended? new sub purchased? etc).
   *
   * Reason is required here because expired proxies coming back to
   * available always have a real-world cause that future admins may
   * need to audit (e.g., "Vendor extended thêm 30 ngày" → admin should
   * also update expires_at via Sửa).
   */
  function handleExpiredToAvailable() {
    openReason({
      title: "Cấp lại proxy đã hết hạn?",
      description: `${proxy.host}:${proxy.port} đang ở trạng thái Hết hạn. "Cấp lại" sẽ chuyển proxy về Sẵn sàng — nhớ cập nhật ngày hết hạn (expires_at) qua nút Sửa nếu vendor đã gia hạn.`,
      confirmLabel: "Cấp lại (Hết hạn → Sẵn sàng)",
      destructive: false,
      reasonRequired: true,
      placeholder: "Vd: Vendor gia hạn thêm 30 ngày, tự mua lại sub mới, …",
      onConfirm: async (reason) => {
        await onSetStatus("available", reason);
        toast.success("Đã cấp lại proxy — nhớ cập nhật ngày hết hạn");
      },
    });
  }

  function handleToggleHidden() {
    // Wave 26-D bug hunt v2 [P0-2] — error path was silently dropped.
    // Pre-fix: if onToggleHidden rejected (network/permission/etc),
    // admin saw NO toast and the UI stayed in pre-toggle state with
    // no signal. Now: explicit .catch + error toast.
    void onToggleHidden(!proxy.hidden)
      .then(() => {
        toast.success(
          proxy.hidden ? "Đã hiện proxy" : "Đã ẩn proxy khỏi danh sách",
        );
      })
      .catch((err: unknown) => {
        console.error("Toggle hidden failed:", err);
        toast.error(
          proxy.hidden
            ? "Không hiện được proxy"
            : "Không ẩn được proxy",
        );
      });
  }

  // ─── Render ────────────────────────────────────────────────────────

  const isInTrash = proxy.is_deleted;

  // Trash state has its own minimal row — no other actions until restore.
  if (isInTrash) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={!canWrite}
            onClick={() => {
              void onRestoreFromTrash().then(() => {
                toast.success("Đã khôi phục từ thùng rác");
              });
            }}
            className="gap-1.5"
          >
            <RotateCcw className="size-4" />
            Khôi phục từ thùng rác
          </Button>
          <Button variant="outline" onClick={handleCopy} className="gap-1.5">
            <Copy className="size-4" />
            Sao chép
          </Button>
        </div>
        {reasonState && (
          <ReasonDialog state={reasonState} onClose={closeReason} />
        )}
      </>
    );
  }

  // Build the primary actions array — same shape, dispatched by status.
  type PrimaryAction = {
    label: string;
    onClick: () => void;
    icon: React.ComponentType<{ className?: string }>;
    variant?: "default" | "destructive" | "outline";
    disabled?: boolean;
    title?: string;
  };

  const primaryActions: PrimaryAction[] = [];

  // Edit + health check are always primary (admin always wants quick access).
  primaryActions.push({
    label: "Sửa",
    onClick: onEdit,
    icon: Pencil,
    variant: "outline",
    disabled: !canWrite,
  });
  primaryActions.push({
    label: healthChecking ? "Đang kiểm..." : "Kiểm tra ngay",
    onClick: handleHealthCheck,
    icon: Activity,
    variant: "outline",
    disabled: healthChecking,
  });

  // Status-contextual primary action.
  switch (proxy.status) {
    case "available":
      // Wave 26-D-pre1 placeholder — manual assign flow ships in 26-D
      primaryActions.unshift({
        label: "Cấp thủ công",
        onClick: () => toast.info("Cấp thủ công sẽ có ở Wave 26-D"),
        icon: Sparkles,
        variant: "default",
        disabled: true,
        title: "Sẽ có ở Wave 26-D",
      });
      break;
    case "assigned":
      primaryActions.unshift({
        label: "Thu hồi",
        onClick: handleUnassign,
        icon: UserMinus,
        variant: "default",
        disabled: !canWrite,
      });
      break;
    case "expired":
      primaryActions.unshift({
        label: "Cấp lại",
        onClick: handleExpiredToAvailable,
        icon: RotateCcw,
        variant: "default",
        disabled: !canWrite,
      });
      break;
    case "banned":
      primaryActions.unshift({
        label: "Khôi phục",
        onClick: handleRestoreFromBanned,
        icon: RotateCcw,
        variant: "default",
        disabled: !canWrite,
      });
      break;
    case "maintenance":
      primaryActions.unshift({
        label: "Đưa về Sẵn sàng",
        onClick: handleMaintenanceToAvailable,
        icon: CheckCircle2,
        variant: "default",
        disabled: !canWrite,
      });
      break;
    default:
      // reported_broken etc — Wave 26-D handles
      break;
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {primaryActions.map((action) => {
          const Icon = action.icon;
          return (
            <Button
              key={action.label}
              variant={action.variant ?? "default"}
              onClick={action.onClick}
              disabled={action.disabled}
              title={action.title}
              className="gap-1.5"
            >
              <Icon className="size-4" />
              {action.label}
            </Button>
          );
        })}

        {/* Overflow menu — destructive + rare actions */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="icon"
                aria-label="Thao tác khác"
                className="shrink-0"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={handleCopy}>
              <Copy className="size-4" />
              Sao chép proxy
            </DropdownMenuItem>
            {canWrite && (
              <>
                <DropdownMenuItem onClick={handleToggleHidden}>
                  {proxy.hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                  {proxy.hidden ? "Hiện trở lại" : "Ẩn khỏi danh sách"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {proxy.status === "assigned" && (
                  <DropdownMenuItem onClick={handleForceExpire} variant="destructive">
                    <XCircle className="size-4" />
                    Đánh dấu hết hạn ngay
                  </DropdownMenuItem>
                )}
                {(proxy.status === "available" ||
                  proxy.status === "assigned" ||
                  proxy.status === "maintenance") && (
                  <DropdownMenuItem onClick={handleMarkBanned} variant="destructive">
                    <Ban className="size-4" />
                    Đánh dấu Báo lỗi
                  </DropdownMenuItem>
                )}
                {proxy.status === "banned" && (
                  <DropdownMenuItem
                    onClick={() => toast.info("Clone as new proxy sẽ có ở Wave 26-D")}
                    disabled
                  >
                    <Sparkles className="size-4" />
                    Clone as new proxy
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => setSoftDeleteOpen(true)}
                  variant="destructive"
                >
                  <Trash2 className="size-4" />
                  Chuyển vào thùng rác
                </DropdownMenuItem>
              </>
            )}
            {!canWrite && (
              <DropdownMenuItem disabled>
                <ShieldOff className="size-4" />
                Bạn không có quyền chỉnh sửa
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {reasonState && <ReasonDialog state={reasonState} onClose={closeReason} />}

      <ConfirmDialog
        open={softDeleteOpen}
        onOpenChange={setSoftDeleteOpen}
        variant="destructive"
        title="Chuyển proxy này vào thùng rác?"
        description={`${proxy.host}:${proxy.port} sẽ được chuyển vào Thùng rác. Bạn có 30 ngày để khôi phục trước khi hệ thống xoá vĩnh viễn.`}
        confirmText="Chuyển vào thùng rác"
        cancelText="Huỷ"
        onConfirm={async () => {
          await onSoftDelete();
        }}
      />
    </>
  );
}
