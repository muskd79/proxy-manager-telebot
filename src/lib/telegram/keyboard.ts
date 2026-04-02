import { InlineKeyboard } from "grammy";

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
    .text("Tieng Viet", "lang:vi")
    .text("English", "lang:en");
}

/** Confirmation keyboard */
export function confirmKeyboard(lang: "vi" | "en"): InlineKeyboard {
  const yes = lang === "vi" ? "Co" : "Yes";
  const no = lang === "vi" ? "Khong" : "No";

  return new InlineKeyboard()
    .text(yes, "confirm:yes")
    .text(no, "confirm:no");
}
