import { InlineKeyboard } from "grammy";
import type { SupportedLanguage } from "@/types/telegram";

/**
 * Wave 23B-bot — main inline menu shown after /start.
 *
 * 4 rows × 2 columns = 8 buttons. Layout matches user spec:
 *   row 1: Yêu cầu proxy           | Proxy của tôi
 *   row 2: Kiểm tra proxy          | Limit yêu cầu (formerly Trạng thái)
 *   row 3: Bảo hành proxy          | Lịch sử
 *      (warranty label routes to revoke flow; full warranty
 *       schema is deferred to Wave 24 per warranty-rename agent.)
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
        warranty: "Bảo hành proxy",
        history: "Lịch sử",
        help: "Hướng dẫn",
        language: "English",
      }
    : {
        request: "Request proxy",
        my: "My proxies",
        check: "Check proxy",
        limit: "Quota & limits",
        warranty: "Warranty claim",
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
    .text(labels.warranty, "menu:warranty")
    .text(labels.history, "menu:history")
    .row()
    .text(labels.help, "menu:help")
    .text(labels.language, "menu:language");
}

/** Proxy type selection keyboard */
export function proxyTypeKeyboard(lang: "vi" | "en"): InlineKeyboard {
  const labels =
    lang === "vi"
      ? { http: "HTTP", https: "HTTPS", socks5: "SOCKS5" }
      : { http: "HTTP", https: "HTTPS", socks5: "SOCKS5" };

  return new InlineKeyboard()
    .text(labels.http, "proxy_type:http")
    .text(labels.https, "proxy_type:https")
    .text(labels.socks5, "proxy_type:socks5");
}

/** Language selection keyboard */
export function languageKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Tiếng Việt", "lang:vi")
    .text("English", "lang:en");
}

/** Quantity selection keyboard for bulk proxy requests */
export function quantityKeyboard(proxyType: string, lang: SupportedLanguage): InlineKeyboard {
  return new InlineKeyboard()
    .text("1", `qty:${proxyType}:1`)
    .text("2", `qty:${proxyType}:2`)
    .text("5", `qty:${proxyType}:5`)
    .row()
    .text("10", `qty:${proxyType}:10`);
}

/** Confirmation keyboard */
export function confirmKeyboard(lang: "vi" | "en"): InlineKeyboard {
  const yes = lang === "vi" ? "Có" : "Yes";
  const no = lang === "vi" ? "Không" : "No";

  return new InlineKeyboard()
    .text(yes, "confirm:yes")
    .text(no, "confirm:no");
}
