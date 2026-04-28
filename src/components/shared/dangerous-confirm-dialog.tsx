"use client";

import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle } from "lucide-react";

/**
 * Wave 22O — DangerousConfirmDialog
 *
 * Pattern mượn từ VIA project. Thay thế <AlertDialog> đơn giản 1-click
 * cho các thao tác destructive bulk hoặc permanent — yêu cầu admin
 * gõ chuỗi xác nhận trước khi nút Submit unlock.
 *
 * Use cases (UI/UX agent flagged "không đủ scary" cho 4):
 *   - Hard-delete admin (gõ email admin để xác nhận)
 *   - Bulk delete >50 proxy ("DELETE 1000")
 *   - Force-disable 2FA (gõ "DISABLE")
 *   - Permanently empty trash
 *
 * Design:
 *   - Title + warning icon + description
 *   - Hiển thị `confirmString` user phải gõ y hệt
 *   - Submit button disabled cho tới khi input === confirmString
 *   - ESC + click outside → cancel (an toàn — chỉ unlock khi gõ đúng)
 */

interface DangerousConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  /**
   * Chuỗi user phải gõ y hệt để unlock submit. Ví dụ: email admin,
   * "DELETE 1000", "DISABLE". Case-sensitive — admin phải gõ chính xác.
   */
  confirmString: string;
  /**
   * Hint hiển thị dưới input để hướng dẫn admin gõ gì.
   */
  confirmHint?: string;
  /** Action label trên Submit button. Default "Xoá vĩnh viễn". */
  actionLabel?: string;
  /** Cancel label. Default "Huỷ". */
  cancelLabel?: string;
  /** Đang xử lý — disable button + spinner. */
  loading?: boolean;
  /** Submit handler — chỉ chạy khi user gõ đúng confirmString. */
  onConfirm: () => void | Promise<void>;
}

export function DangerousConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmString,
  confirmHint,
  actionLabel = "Xoá vĩnh viễn",
  cancelLabel = "Huỷ",
  loading = false,
  onConfirm,
}: DangerousConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const matches = typed === confirmString;

  // Reset typed when dialog closes so re-open starts fresh.
  function handleOpenChange(o: boolean) {
    if (!o) setTyped("");
    onOpenChange(o);
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <Label htmlFor="confirm-input" className="text-xs uppercase tracking-wide">
              {confirmHint ?? `Gõ "${confirmString}" để xác nhận`}
            </Label>
            <Input
              id="confirm-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmString}
              className="mt-2 font-mono"
              autoComplete="off"
              autoFocus
            />
            {typed.length > 0 && !matches && (
              <p className="mt-1.5 text-xs text-destructive">
                Không khớp — gõ chính xác {`"${confirmString}"`}
              </p>
            )}
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={!matches || loading}
            className="bg-destructive hover:bg-destructive/90"
          >
            {loading ? "Đang xử lý..." : actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
