"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface BaseProps {
  title: string;
  // Wave 27 a11y/mobile [P0-3] — accept ReactNode so callers can mix
  // bold / line-breaks / `<code>`-style emphasis (mirrors
  // DangerousConfirmDialog API). Plain strings still work unchanged.
  description: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
  loading?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}

// Uncontrolled: trigger element opens the dialog.
interface TriggerProps extends BaseProps {
  trigger: React.ReactNode;
  open?: never;
  onOpenChange?: never;
}

// Controlled: parent owns `open`; no trigger needed.
interface ControlledProps extends BaseProps {
  trigger?: never;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ConfirmDialogProps = TriggerProps | ControlledProps;

/**
 * Confirm dialog with controlled or uncontrolled open state.
 *
 * When `loading` is true we disable the cancel button and mark the action as
 * pending; the dialog is also pinned open so the user cannot dismiss it by
 * pressing Escape or clicking the backdrop while work is in-flight.
 */
// Wave 27 a11y/mobile [P2-8] — defaults flipped to Vietnamese.
// Pre-fix: defaults were "Confirm" / "Cancel" / "..." despite the
// project being Vietnamese-first. Most call sites override, but any
// caller that forgets surfaces English to the admin. Explicit
// overrides still win — zero-risk change.
export function ConfirmDialog({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  confirmText = "Xác nhận",
  cancelText = "Huỷ",
  variant = "default",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // While loading, swallow close requests so the destructive action cannot
  // be cancelled half-way through.
  const handleOpenChange = (next: boolean) => {
    if (loading && !next) return;
    onOpenChange?.(next);
  };

  return (
    <AlertDialog
      {...(open !== undefined
        ? { open, onOpenChange: handleOpenChange }
        : {})}
    >
      {trigger !== undefined && (
        <AlertDialogTrigger render={trigger as React.ReactElement} />
      )}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={loading}>
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={loading}
            variant={variant === "destructive" ? "destructive" : "default"}
          >
            {loading ? "Đang xử lý..." : confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
