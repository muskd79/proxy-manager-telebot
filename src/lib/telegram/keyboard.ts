import { InlineKeyboard } from "grammy";
import type { SupportedLanguage } from "@/types/telegram";

/**
 * Wave 23B-bot — main inline menu shown after /start.
 *
 * 4 rows × 2 columns = 8 buttons. Layout matches user spec:
 *   row 1: Yêu cầu proxy           | Proxy của tôi
 *   row 2: Kiểm tra proxy          | Limit yêu cầu (formerly Trạng thái)
 *   row 3: Trả proxy               | Lịch sử
 *      Wave 25-pre2 (P0 1.1) — renamed from "Bảo hành proxy" /
 *      "Warranty claim". The pre-25 label was a lie: clicking it
 *      ran the revoke flow (return-no-replacement), not a warranty
 *      claim (broken-proxy → replacement). Real warranty schema is
 *      tracked in docs/decision-log.md#warranty-schema and deferred
 *      to Wave 26. Callback prefix renamed `menu:warranty` →
 *      `menu:return` so future warranty work doesn't share a name
 *      with the revoke flow.
 *   row 4: Hướng dẫn               | English / Tiếng Việt
 *
 * Replaces the persistent reply Keyboard() previously rendered in
 * start.ts:110, which made the bot UI cluttered (two keyboards on
 * screen at once). User feedback 2026-04-29: "tắt menu hiện sẵn
 * bên dưới cùng đi, chỉ để chữ nút Menu bên trái nút up file thôi".
 */
export function mainMenuKeyboard(lang: SupportedLanguage): InlineKeyboard {
  const labels = lang === "vi"
    ? {
        request: "Yêu cầu proxy",
        my: "Proxy của tôi",
        check: "Kiểm tra proxy",
        limit: "Limit yêu cầu",
        return: "Trả proxy",
        history: "Lịch sử",
        help: "Hướng dẫn",
        language: "English",
      }
    : {
        request: "Request proxy",
        my: "My proxies",
        check: "Check proxy",
        limit: "Quota & limits",
        return: "Return proxy",
        history: "History",
        help: "Help",
        language: "Tiếng Việt",
      };

  return new InlineKeyboard()
    .text(labels.request, "menu:request")
    .text(labels.my, "menu:my")
    .row()
    .text(labels.check, "menu:check")
    .text(labels.limit, "menu:limit")
    .row()
    .text(labels.return, "menu:return")
    .text(labels.history, "menu:history")
    .row()
    .text(labels.help, "menu:help")
    .text(labels.language, "menu:language");
}

/** Proxy type selection keyboard */
export function proxyTypeKeyboard(lang: "vi" | "en"): InlineKeyboard {
  // Wave 23B-bot UX — added Hủy / Cancel row so the user can back
  // out without typing /cancel.
  const cancel = lang === "vi" ? "Hủy" : "Cancel";

  return new InlineKeyboard()
    .text("HTTP", "proxy_type:http")
    .text("HTTPS", "proxy_type:https")
    .text("SOCKS5", "proxy_type:socks5")
    .row()
    .text(cancel, "proxy_type:cancel");
}

/** Language selection keyboard */
export function languageKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Tiếng Việt", "lang:vi")
    .text("English", "lang:en");
}

/**
 * Quantity selection keyboard.
 *
 * Wave 23B-bot UX (per VIA pattern) — `mode` carries through the
 * callback so handleQuantitySelection knows whether the user picked
 * Order nhanh (quick=auto-assign) or Order riêng (custom=manual,
 * needs admin approval). Format: `qty:<mode>:<type>:<n>`.
 *
 * `mode` is a literal string; default 'quick' preserves the legacy
 * callback shape `qty:<type>:<n>` was, but new flow always supplies
 * an explicit mode.
 */
export type OrderMode = "quick" | "custom";

export function quantityKeyboard(
  proxyType: string,
  lang: SupportedLanguage,
  mode: OrderMode = "quick",
): InlineKeyboard {
  // Wave 23B-bot UX — Order riêng allows higher quantities since
  // admin will review anyway. Order nhanh stays at the original
  // 1/2/5/10 throttle to protect auto-assignment quota.
  const cancel = lang === "vi" ? "Hủy" : "Cancel";
  if (mode === "custom") {
    return new InlineKeyboard()
      .text("5", `qty:custom:${proxyType}:5`)
      .text("10", `qty:custom:${proxyType}:10`)
      .text("20", `qty:custom:${proxyType}:20`)
      .row()
      .text("50", `qty:custom:${proxyType}:50`)
      .text("100", `qty:custom:${proxyType}:100`)
      .row()
      .text(cancel, "qty:custom:cancel");
  }
  return new InlineKeyboard()
    .text("1", `qty:quick:${proxyType}:1`)
    .text("2", `qty:quick:${proxyType}:2`)
    .text("5", `qty:quick:${proxyType}:5`)
    .row()
    .text("10", `qty:quick:${proxyType}:10`)
    .text(cancel, "qty:quick:cancel");
}

/**
 * Wave 23B-bot UX — order type chooser shown after a user picks
 * a proxy type. Mirrors VIA bot's getvia.ts → "custom.choose_type"
 * pattern: 2 explicit modes + cancel.
 */
export function orderTypeKeyboard(
  proxyType: string,
  lang: SupportedLanguage,
): InlineKeyboard {
  const labels = lang === "vi"
    ? { quick: "Order nhanh", custom: "Order riêng", cancel: "Hủy" }
    : { quick: "Quick order", custom: "Custom order", cancel: "Cancel" };
  return new InlineKeyboard()
    .text(labels.quick, `order_quick:${proxyType}`)
    .text(labels.custom, `order_custom:${proxyType}`)
    .row()
    .text(labels.cancel, "order_type:cancel");
}

/** Confirmation keyboard */
export function confirmKeyboard(lang: "vi" | "en"): InlineKeyboard {
  const yes = lang === "vi" ? "Có" : "Yes";
  const no = lang === "vi" ? "Không" : "No";

  return new InlineKeyboard()
    .text(yes, "confirm:yes")
    .text(no, "confirm:no");
}
