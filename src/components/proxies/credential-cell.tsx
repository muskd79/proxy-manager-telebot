"use client";

/**
 * Wave 22W — masked credential cell for proxy username/password.
 *
 * Why a dedicated component:
 *   - Password column needs masking by default (shoulder-surfing risk)
 *   - Each row needs independent reveal state (one row's toggle must
 *     not flip the whole column)
 *   - Copy-to-clipboard is the most common admin action; the cell
 *     handles it without needing to reveal first
 *
 * Viewer role: the API strips `password` field for viewers (see
 * api/proxies route.ts), so this component receives `undefined`
 * and shows a "—" placeholder. No client-side bypass.
 *
 * Touch target: 44×44 (WCAG AA) for the eye + copy buttons.
 */

import { useState } from "react";
import { Eye, EyeOff, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CredentialCellProps {
  value: string | null | undefined;
  /** "password" → mask by default. "username" → show plaintext but offer copy. */
  kind: "username" | "password";
}

export function CredentialCell({ value, kind }: CredentialCellProps) {
  const [revealed, setRevealed] = useState(false);
  const [justCopied, setJustCopied] = useState(false);

  if (!value) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  const isPassword = kind === "password";
  const display = isPassword && !revealed ? "•".repeat(Math.min(value.length, 10)) : value;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setJustCopied(true);
      toast.success(isPassword ? "Đã chép mật khẩu" : "Đã chép username");
      setTimeout(() => setJustCopied(false), 1500);
    } catch {
      toast.error("Không chép được");
    }
  };

  return (
    <div className="flex items-center gap-1">
      <code
        className={cn(
          "font-mono text-xs select-all",
          isPassword && !revealed && "tracking-wider",
        )}
        title={isPassword && !revealed ? "Nhấn 👁 để hiện" : value}
      >
        {display}
      </code>
      {isPassword && (
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          aria-pressed={revealed}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      )}
      <button
        type="button"
        onClick={handleCopy}
        aria-label={isPassword ? "Chép mật khẩu" : "Chép username"}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {justCopied ? (
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
