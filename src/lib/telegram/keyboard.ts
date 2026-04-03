import { InlineKeyboard } from "grammy";
import type { SupportedLanguage } from "@/types/telegram";

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
