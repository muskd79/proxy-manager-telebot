/**
 * Wave 25-pre3 (Pass 2.B) — single-button recovery keyboards for
 * "session expired" / "phiên hết hạn" dead-ends.
 *
 * Pre-fix multiple places said "Phiên hết hạn. Bấm /getproxy để bắt
 * đầu lại." (text-only). User had to type the slash command to
 * restart. Now: 1-button keyboard pointing at the right entry.
 *
 * One helper per recovery target. Each builds a single-button
 * `InlineKeyboard` whose callback is a `menu:*` action so it routes
 * through the existing dispatcher in handlers.ts (no new prefix to
 * register).
 *
 * Use sites:
 *   - custom-order.ts handleConfirmCallback when state drift /
 *     awaiting_confirm TTL expires
 *   - get-proxy.ts when the user has a pending request and tried
 *     /getproxy again (pair with the existing recovery hint copy
 *     from Wave 25-pre2)
 *   - language.ts after a mid-flow language switch (recovery prompt
 *     to re-start)
 *   - start.ts pending-approval path could optionally include a
 *     "/support" CTA — but for a pending user we don't want a
 *     premature "Yêu cầu lại" before admin approves; skip there.
 */

import { InlineKeyboard } from "grammy";
import type { SupportedLanguage } from "@/types/telegram";
import { CB } from "./callbacks";

export type RecoveryTarget = "request" | "check" | "menu";

const LABELS = {
  vi: {
    request: "Yêu cầu lại",
    check: "Kiểm tra lại",
    menu: "Về menu",
  },
  en: {
    request: "Request again",
    check: "Check again",
    menu: "Back to menu",
  },
} as const;

/**
 * Build a single-row `InlineKeyboard` with one "restart this flow"
 * button. The callback routes through the main-menu dispatcher
 * (handlers.ts case "menu") via `menu:request | menu:check`. For
 * `target = "menu"` we route to `menu:request` (the menu surface
 * starts at request anyway, and avoids adding a new "menu:home"
 * action to the union just for this one button).
 */
export function restartFlowKeyboard(
  lang: SupportedLanguage,
  target: RecoveryTarget,
): InlineKeyboard {
  const label = LABELS[lang][target];
  const action = target === "check" ? "check" : "request";
  return new InlineKeyboard().text(label, CB.menu(action));
}
