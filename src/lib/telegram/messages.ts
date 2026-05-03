import type { SupportedLanguage } from "@/types/telegram";

// ---------------------------------------------------------------------------
// All bot message strings (vi/en) – no emojis
// ---------------------------------------------------------------------------

// Wave 25-pre2 (Pass 1.4) — the welcome and help blocks below MUST
// stay in the canonical command order defined by lib/constants.ts
// BOT_COMMANDS. The parity test in __tests__/commands.test.ts will
// fail on drift. Do NOT reorder lines without updating BOT_COMMANDS
// in the same commit.
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
      "/cancel - Hủy yêu cầu",
      "/support - Hỗ trợ",
      "/language - Đổi ngôn ngữ",
      "/help - Hướng dẫn sử dụng",
      "/requests - Duyệt yêu cầu (Admin)",
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
      "/help - Show help",
      "/requests - Approve requests (Admin)",
    ].join("\n"),
  },
  welcomeBack: {
    vi: "Ch\u00E0o m\u1EEBng b\u1EA1n quay l\u1EA1i!",
    en: "Welcome back!",
  },
  help: {
    vi: [
      "*Hướng dẫn sử dụng*",
      "",
      "/start - Bắt đầu và đăng ký",
      "/getproxy - Yêu cầu proxy (chọn loại và số lượng)",
      "/myproxies - Xem proxy được gán với thông tin đăng nhập",
      "/checkproxy - Kiểm tra tình trạng proxy",
      "/status - Xem trạng thái tài khoản và giới hạn",
      "/history - Lịch sử yêu cầu với mã theo dõi",
      "/revoke - Trả proxy không còn sử dụng",
      "/cancel - Hủy yêu cầu đang chờ",
      "/support - Gửi tin nhắn cho admin",
      "/language - Đổi ngôn ngữ (Việt/Anh)",
      "/help - Hiển thị trợ giúp",
      "/requests - Duyệt yêu cầu (Admin)",
      "",
      "*Giới hạn yêu cầu:*",
      "Mỗi người dùng có giới hạn số proxy yêu cầu theo giờ, theo ngày và tổng cộng. Dùng /status để xem chi tiết.",
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
      "/help - Show this help",
      "/requests - Approve requests (Admin)",
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
  // Wave 25-pre4 (Pass 3.A) — distinct copy for the post-approval
  // path. Pre-fix admin-approved proxies used `proxyAssigned` (same
  // template as self-serve auto-assign) — the wait was hours but the
  // reveal looked like an instant grab. Now we acknowledge the wait.
  proxyAssignedAfterApproval: {
    vi: [
      "[OK] Yêu cầu của bạn đã được duyệt — cảm ơn bạn đã đợi!",
      "",
      "`{host}:{port}:{username}:{password}`",
      "",
      "Loại: {type}",
      "Hết hạn: {expires}",
    ].join("\n"),
    en: [
      "[OK] Your request was approved — thanks for waiting!",
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
  accountPendingApproval: {
    // Wave 25-pre4 (Pass 3.B) — append ETA. Pre-fix users with no
    // sense of timeline spammed /start to test if the bot was alive.
    // v1 hardcodes "trong 24 giờ" / "within 24 hours". v2 (deferred
    // to Wave 26) computes from a Supabase `admin_response_avg_seconds`
    // view if/when we have enough data to publish a real number.
    vi: "[!] Tài khoản của bạn đang chờ admin duyệt. Thời gian thường: *trong 24 giờ*. Bạn sẽ nhận thông báo khi được phê duyệt.",
    en: "[!] Your account is pending admin approval. Typical wait: *within 24 hours*. You will be notified once approved.",
  },
  // Wave 23B-bot UX — order type chooser, ported from VIA bot's
  // custom.choose_type. Two explicit modes + status hint.
  chooseOrderType: {
    vi: "Chọn loại đặt hàng:\n• Order nhanh: Tự động, giới hạn từng user\n• Order riêng: Cần admin duyệt yêu cầu\n\nDùng lệnh /status để xem giới hạn của mình",
    en: "Choose order type:\n• Quick order: Automatic, per-user limit\n• Custom order: Requires admin approval\n\nUse /status to check your limits",
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
    vi: "[i] Yêu cầu {count} proxy {type} đang chờ duyệt.",
    en: "[i] Request for {count} {type} proxies is pending approval.",
  },
  pendingApproval: {
    vi: "[i] Tài khoản của bạn đang chờ admin duyệt. Bạn sẽ được thông báo khi được phê duyệt.",
    en: "[i] Your account is pending admin approval. You will be notified when approved.",
  },
  supportMessageReceived: {
    vi: "Tin nhắn đã nhận. Admin sẽ phản hồi sớm.",
    en: "Message received. Admin will respond soon.",
  },
  revokeConfirmAll: {
    vi: "Bạn có chắc không? Hành động này sẽ trả tất cả {count} proxy.",
    en: "Are you sure? This will return ALL {count} proxies.",
  },
  cancelConfirmPrompt: {
    vi: "Hủy tất cả?",
    en: "Cancel all?",
  },
  noAuth: {
    vi: "không xác thực",
    en: "no auth",
  },
  expiresSoon: {
    vi: "[!] Sắp hết hạn!",
    en: "[!] Expires soon!",
  },
  errorOccurred: {
    vi: "[X] Đã có lỗi xảy ra. Vui lòng thử lại hoặc liên hệ admin.",
    en: "[X] An error occurred. Please try again or contact an admin.",
  },
  bulkPartialAssigned: {
    vi: "[OK] Đã cấp {assigned}/{requested} proxy {type}! ({missing} không khả dụng — thử lại sau)",
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
