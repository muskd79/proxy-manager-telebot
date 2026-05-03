import { InlineKeyboard } from "grammy";
import type { SupportedLanguage } from "@/types/telegram";
import { CB } from "./callbacks";

// Wave 25-pre3 (Pass 5.2) — every callback string in this file is now
// constructed via the typed CB.* builders from callbacks.ts. Pre-fix
// raw literals like `"menu:request"` and `"qty:quick:" + type + ":" + n`
// were duplicated wire format that drifted (e.g. `proxy_type:` vs
// `type:`). The builders are the only caller — parseCallback in
// callbacks.ts is the only consumer. One round-trip test pins both
// sides (callbacks.test.ts).

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
        // Wave 26-D-post1/B vocab sweep — drop "Quota" wording (admin
        // doc + Vietnamese label both use "request limit"/"giới hạn
        // yêu cầu"). 14-char budget enforced by keyboard.test.ts still
        // satisfied.
        limit: "Request limit",
        return: "Return proxy",
        history: "History",
        help: "Help",
        language: "Tiếng Việt",
      };

  return new InlineKeyboard()
    .text(labels.request, CB.menu("request"))
    .text(labels.my, CB.menu("my"))
    .row()
    .text(labels.check, CB.menu("check"))
    .text(labels.limit, CB.menu("limit"))
    .row()
    .text(labels.return, CB.menu("return"))
    .text(labels.history, CB.menu("history"))
    .row()
    .text(labels.help, CB.menu("help"))
    .text(labels.language, CB.menu("language"));
}

/** Proxy type selection keyboard */
export function proxyTypeKeyboard(lang: "vi" | "en"): InlineKeyboard {
  // Wave 23B-bot UX — added Hủy / Cancel row so the user can back
  // out without typing /cancel.
  const cancel = lang === "vi" ? "Hủy" : "Cancel";

  return new InlineKeyboard()
    .text("HTTP", CB.type("http"))
    .text("HTTPS", CB.type("https"))
    .text("SOCKS5", CB.type("socks5"))
    .row()
    .text(cancel, CB.typeCancel());
}

/** Language selection keyboard */
export function languageKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Tiếng Việt", CB.lang("vi"))
    .text("English", CB.lang("en"));
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
  // 1/2/5/10 throttle to protect the auto-assignment request limit.
  const cancel = lang === "vi" ? "Hủy" : "Cancel";
  if (mode === "custom") {
    return new InlineKeyboard()
      .text("5", CB.qty("custom", proxyType, 5))
      .text("10", CB.qty("custom", proxyType, 10))
      .text("20", CB.qty("custom", proxyType, 20))
      .row()
      .text("50", CB.qty("custom", proxyType, 50))
      .text("100", CB.qty("custom", proxyType, 100))
      .row()
      .text(cancel, CB.qtyCancel("custom"));
  }
  return new InlineKeyboard()
    .text("1", CB.qty("quick", proxyType, 1))
    .text("2", CB.qty("quick", proxyType, 2))
    .text("5", CB.qty("quick", proxyType, 5))
    .row()
    .text("10", CB.qty("quick", proxyType, 10))
    .text(cancel, CB.qtyCancel("quick"));
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
    .text(labels.quick, CB.order("quick", proxyType))
    .text(labels.custom, CB.order("custom", proxyType))
    .row()
    .text(labels.cancel, CB.orderCancel());
}

/** Confirmation keyboard */
export function confirmKeyboard(lang: "vi" | "en"): InlineKeyboard {
  const yes = lang === "vi" ? "Có" : "Yes";
  const no = lang === "vi" ? "Không" : "No";

  return new InlineKeyboard()
    .text(yes, CB.confirm("yes"))
    .text(no, CB.confirm("no"));
}
