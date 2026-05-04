/**
 * Wave 26-D bug hunt v2 [MEDIUM] — single source of truth for warranty
 * reason-code labels.
 *
 * Pre-fix the same Vietnamese labels were defined three times:
 *   - src/lib/telegram/commands/warranty.ts (REASON_BUTTONS_VI + EN)
 *   - src/components/warranty/warranty-table.tsx (REASON_LABEL)
 *   - copy-paste in admin notification prose
 *
 * Drift was inevitable — when "IP bị block" became "IP bị chặn" in one
 * place, the other two stayed stale and admins saw mixed wording in
 * the same dashboard. Now: every consumer imports from here.
 *
 * Mirrors the pattern in `src/lib/proxy-labels.ts`. If a future i18n
 * switch lands, this is a one-file change.
 */

import type { WarrantyReasonCode } from "@/types/database";

// ─── Vietnamese (default UI language) ─────────────────────────────

export const WARRANTY_REASON_LABEL_VI: Record<WarrantyReasonCode, string> = {
  no_connect: "Không kết nối được",
  slow: "Chậm",
  ip_blocked: "IP bị block",
  wrong_country: "Sai quốc gia",
  auth_fail: "Sai user/pass",
  other: "Khác",
};

// Short variant used in the admin table where vertical space is tight.
export const WARRANTY_REASON_LABEL_VI_SHORT: Record<WarrantyReasonCode, string> = {
  no_connect: "Không kết nối",
  slow: "Chậm",
  ip_blocked: "IP bị block",
  wrong_country: "Sai quốc gia",
  auth_fail: "Sai user/pass",
  other: "Khác",
};

// ─── English (bot fallback for users with lang=en) ────────────────

export const WARRANTY_REASON_LABEL_EN: Record<WarrantyReasonCode, string> = {
  no_connect: "Cannot connect",
  slow: "Too slow",
  ip_blocked: "IP blocked",
  wrong_country: "Wrong country",
  auth_fail: "Auth failed",
  other: "Other",
};

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Returns the user-facing label for a warranty reason code in the
 * given language. Falls back to Vietnamese (the default UI language)
 * if the lang code is not recognised.
 */
export function warrantyReasonLabel(
  code: WarrantyReasonCode,
  lang: "vi" | "en" = "vi",
): string {
  return lang === "en"
    ? WARRANTY_REASON_LABEL_EN[code]
    : WARRANTY_REASON_LABEL_VI[code];
}
