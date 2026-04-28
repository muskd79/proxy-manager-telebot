import type { SupportedLanguage } from "@/types/telegram";

// ---------------------------------------------------------------------------
// All bot message strings (vi/en) – no emojis
// ---------------------------------------------------------------------------

export const msg = {
  welcome: {
    vi: [
      "*Proxy Manager Bot*",
      "",
      "Xin ch\u00E0o! Bot gi\u00FAp b\u1EA1n qu\u1EA3n l\u00FD v\u00E0 nh\u1EADn proxy nhanh ch\u00F3ng.",
      "",
      "*C\u00E1c l\u1EC7nh c\u00F3 s\u1EB5n:*",
      "/getproxy - Yêu cầu proxy mới",
      "/myproxies - Xem proxy của bạn",
      "/checkproxy - Kiểm tra proxy",
      "/status - Trạng thái tài khoản",
      "/history - Lịch sử yêu cầu",
      "/revoke - Trả proxy",
      "/cancel - Huỷ yêu cầu",
      "/support - Hỗ trợ",
      "/language - Đổi ngôn ngữ",
      "/requests - Duyệt yêu cầu (Admin)",
      "/help - Hướng dẫn sử dụng",
    ].join("\n"),
    en: [
      "*Proxy Manager Bot*",
      "",
      "Hello! This bot helps you manage and receive proxies quickly.",
      "",
      "*Available commands:*",
      "/getproxy - Request a new proxy",
      "/myproxies - View your proxies",
      "/checkproxy - Check proxy health",
      "/status - Account status",
      "/history - Request history",
      "/revoke - Return proxy",
      "/cancel - Cancel request",
      "/support - Contact support",
      "/language - Change language",
      "/requests - Approve requests (Admin)",
      "/help - Show help",
    ].join("\n"),
  },
  welcomeBack: {
    vi: "Ch\u00E0o m\u1EEBng b\u1EA1n quay l\u1EA1i!",
    en: "Welcome back!",
  },
  help: {
    vi: [
      "*Huong dan su dung*",
      "",
      "/start - Bat dau va dang ky",
      "/getproxy - Yeu cau proxy (chon loai va so luong)",
      "/myproxies - Xem proxy duoc gan voi thong tin dang nhap",
      "/checkproxy - Kiem tra tinh trang proxy",
      "/status - Xem trang thai tai khoan va gioi han",
      "/history - Lich su yeu cau voi ma theo doi",
      "/revoke - Tra proxy khong con su dung",
      "/cancel - Huy yeu cau dang cho",
      "/support - Gui tin nhan cho admin",
      "/language - Doi ngon ngu (Viet/Anh)",
      "/requests - Duyet yeu cau (Admin)",
      "/help - Hien thi tro giup",
      "",
      "*Gioi han yeu cau:*",
      "Moi nguoi dung co gioi han so proxy yeu cau theo gio, theo ngay va tong cong. Dung /status de xem chi tiet.",
    ].join("\n"),
    en: [
      "*Help & Commands*",
      "",
      "/start - Start and register",
      "/getproxy - Request proxy (choose type and quantity)",
      "/myproxies - View your assigned proxies with credentials",
      "/checkproxy - Check proxy health status",
      "/status - Account status and rate limits",
      "/history - Request history with tracking IDs",
      "/revoke - Return proxy you no longer need",
      "/cancel - Cancel pending requests",
      "/support - Send message to admin",
      "/language - Change language (Vi/En)",
      "/requests - Approve requests (Admin)",
      "/help - Show this help",
      "",
      "*Rate limits:*",
      "Each user has hourly, daily, and total request limits. Use /status to see details.",
    ].join("\n"),
  },
  selectProxyType: {
    vi: "Ch\u1ECDn lo\u1EA1i proxy b\u1EA1n mu\u1ED1n:",
    en: "Select the proxy type you want:",
  },
  rateLimitExceeded: {
    vi: "[!] B\u1EA1n \u0111\u00E3 v\u01B0\u1EE3t qu\u00E1 gi\u1EDBi h\u1EA1n y\u00EAu c\u1EA7u. Vui l\u00F2ng th\u1EED l\u1EA1i sau.",
    en: "[!] You have exceeded the request limit. Please try again later.",
  },
  noProxyAvailable: {
    vi: "[X] Hi\u1EC7n t\u1EA1i kh\u00F4ng c\u00F3 proxy n\u00E0o kh\u1EA3 d\u1EE5ng cho lo\u1EA1i n\u00E0y.",
    en: "[X] No proxy is currently available for this type.",
  },
  proxyAssigned: {
    vi: [
      "[OK] Proxy đã được cấp!",
      "",
      "`{host}:{port}:{username}:{password}`",
      "",
      "Loại: {type}",
      "Hết hạn: {expires}",
    ].join("\n"),
    en: [
      "[OK] Proxy assigned!",
      "",
      "`{host}:{port}:{username}:{password}`",
      "",
      "Type: {type}",
      "Expires: {expires}",
    ].join("\n"),
  },
  requestPending: {
    vi: "[i] Y\u00EAu c\u1EA7u c\u1EE7a b\u1EA1n \u0111\u00E3 \u0111\u01B0\u1EE3c t\u1EA1o v\u00E0 \u0111ang ch\u1EDD duy\u1EC7t.\nID: `{id}`",
    en: "[i] Your request has been created and is pending approval.\nID: `{id}`",
  },
  noProxies: {
    vi: "B\u1EA1n ch\u01B0a \u0111\u01B0\u1EE3c c\u1EA5p proxy n\u00E0o.",
    en: "You have no assigned proxies.",
  },
  accountBlocked: {
    vi: "[X] T\u00E0i kho\u1EA3n c\u1EE7a b\u1EA1n \u0111\u00E3 b\u1ECB kh\u00F3a. Li\u00EAn h\u1EC7 admin \u0111\u1EC3 bi\u1EBFt th\u00EAm.",
    en: "[X] Your account has been blocked. Contact admin for details.",
  },
  languageSelect: {
    vi: "Ch\u1ECDn ng\u00F4n ng\u1EEF / Select language:",
    en: "Select language / Ch\u1ECDn ng\u00F4n ng\u1EEF:",
  },
  languageChanged: {
    vi: "[OK] Ng\u00F4n ng\u1EEF \u0111\u00E3 \u0111\u01B0\u1EE3c \u0111\u1ED5i sang Ti\u1EBFng Vi\u1EC7t.",
    en: "[OK] Language changed to English.",
  },
  unknownCommand: {
    vi: "[X] L\u1EC7nh kh\u00F4ng h\u1EE3p l\u1EC7. S\u1EED d\u1EE5ng /help \u0111\u1EC3 xem c\u00E1c l\u1EC7nh.",
    en: "[X] Unknown command. Use /help to see available commands.",
  },
  maxProxiesReached: {
    vi: "[!] B\u1EA1n \u0111\u00E3 \u0111\u1EA1t gi\u1EDBi h\u1EA1n proxy t\u1ED1i \u0111a ({max_proxies}). Kh\u00F4ng th\u1EC3 y\u00EAu c\u1EA7u th\u00EAm.",
    en: "[!] You have reached the maximum proxy limit ({max_proxies}). Cannot request more.",
  },
  selectQuantity: {
    vi: "B\u1EA1n c\u1EA7n bao nhi\u00EAu proxy?",
    en: "How many proxies do you need?",
  },
  bulkProxyAssigned: {
    vi: "[OK] \u0110\u00E3 c\u1EA5p {count} proxy {type}!",
    en: "[OK] {count} {type} proxies assigned!",
  },
  bulkRequestPending: {
    vi: "[i] Yeu cau {count} proxy {type} dang cho duyet.",
    en: "[i] Request for {count} {type} proxies is pending approval.",
  },
  pendingApproval: {
    vi: "[i] Tai khoan cua ban dang cho admin duyet. Ban se duoc thong bao khi duoc phe duyet.",
    en: "[i] Your account is pending admin approval. You will be notified when approved.",
  },
  supportMessageReceived: {
    vi: "Tin nhan da nhan. Admin se phan hoi som.",
    en: "Message received. Admin will respond soon.",
  },
  revokeConfirmAll: {
    vi: "Ban co chac khong? Hanh dong nay se tra tat ca {count} proxy.",
    en: "Are you sure? This will return ALL {count} proxies.",
  },
  cancelConfirmPrompt: {
    vi: "Huy tat ca?",
    en: "Cancel all?",
  },
  noAuth: {
    vi: "khong xac thuc",
    en: "no auth",
  },
  expiresSoon: {
    vi: "[!] Sap het han!",
    en: "[!] Expires soon!",
  },
  errorOccurred: {
    vi: "[X] Đã có lỗi xảy ra. Vui lòng thử lại hoặc liên hệ admin.",
    en: "[X] An error occurred. Please try again or contact an admin.",
  },
  bulkPartialAssigned: {
    vi: "[OK] {assigned}/{requested} proxy {type} da cap! ({missing} khong kha dung - thu lai sau)",
    en: "[OK] {assigned}/{requested} proxies assigned! ({missing} not available - try again later)",
  },
};

export function t(key: keyof typeof msg, lang: SupportedLanguage): string {
  return msg[key][lang] || msg[key].en;
}

export function fillTemplate(
  template: string,
  vars: Record<string, string>
): string {
  let result = template;
  for (const [k, v] of Object.entries(vars)) {
    result = result.replaceAll(`{${k}}`, v);
  }
  return result;
}
