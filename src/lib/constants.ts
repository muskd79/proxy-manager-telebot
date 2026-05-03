// Pagination
export const PAGE_SIZES = [20, 50, 100, 500] as const;
export const DEFAULT_PAGE_SIZE = 20;

// Rate Limiting
export const API_RATE_LIMIT_PER_MINUTE = 100;
export const API_RATE_LIMIT_WINDOW_MS = 60_000;

// Proxy
export const HEALTH_CHECK_TIMEOUT_MS = 10_000;
export const HEALTH_CHECK_CONCURRENCY = 50;
export const IMPORT_BATCH_SIZE = 500;

// Health Check Cron
export const HEALTH_CHECK_CRON_BATCH_SIZE = 2000;

// Trash
export const TRASH_AUTO_CLEAN_DAYS = 30;

// Bot
//
// Note (Phase 3 — 2026-05-02): VI descriptions ARE accented even
// though Telegram's native bot menu (the Menu button next to the
// file-attach in chat) renders them in a tight strip. Telegram
// fully supports UTF-8 here, the un-accented strings were a
// historical artefact. The descriptions are pushed to Telegram
// via `bot.api.setMyCommands(...)` in src/lib/telegram/handlers.ts;
// changes propagate the next time setMyCommands runs (on cold
// start of the webhook lambda).
//
// ORDER POLICY (Wave 25-pre2 / Pass 1.4)
// --------------------------------------
// Surface order is grouped by user-task urgency, NOT alphabetised.
// Three lists must stay in sync:
//   (1) BOT_COMMANDS (this array — drives Telegram setMyCommands)
//   (2) src/lib/telegram/messages.ts msg.welcome.{vi,en}
//   (3) src/lib/telegram/messages.ts msg.help.{vi,en}
// The order is enforced by __tests__/commands.test.ts.
//
// Canonical sequence:
//   1.  start      — entry
//   2.  getproxy   — main flow
//   3.  myproxies
//   4.  checkproxy
//   5.  status
//   6.  history
//   7.  revoke
//   8.  cancel     — recovery
//   9.  support
//   10. language   — settings
//   11. help
//   12. requests   — admin-only
//
// When adding a new command, decide which group it belongs to and
// insert it at the right position; update both messages.ts blocks;
// run the parity test.
export const BOT_COMMANDS = [
  { command: "start", description_vi: "Bắt đầu và đăng ký", description_en: "Start and register" },
  { command: "getproxy", description_vi: "Yêu cầu proxy mới", description_en: "Request a new proxy" },
  { command: "myproxies", description_vi: "Xem proxy của bạn", description_en: "View your proxies" },
  { command: "checkproxy", description_vi: "Kiểm tra proxy", description_en: "Check proxy health" },
  { command: "status", description_vi: "Trạng thái tài khoản", description_en: "Account status" },
  { command: "history", description_vi: "Lịch sử yêu cầu", description_en: "Request history" },
  { command: "revoke", description_vi: "Trả proxy", description_en: "Return proxy" },
  { command: "cancel", description_vi: "Hủy yêu cầu đang chờ", description_en: "Cancel pending requests" },
  { command: "support", description_vi: "Hỗ trợ", description_en: "Contact support" },
  { command: "language", description_vi: "Đổi ngôn ngữ", description_en: "Change language" },
  { command: "help", description_vi: "Hướng dẫn sử dụng", description_en: "Help" },
  { command: "requests", description_vi: "Duyệt yêu cầu (Admin)", description_en: "Pending requests (Admin)" },
] as const;

// Wave 22D-5: deleted unused constants SIDEBAR_WIDTH,
// SIDEBAR_COLLAPSED_WIDTH (sidebar uses Tailwind class tokens
// directly), and ANALYTICS_DAYS (analytics route hard-codes its
// own window). Add back here only when a caller needs them.

// Timing thresholds (all values in milliseconds)
// Wave 22AB — threshold dropped from 7 days to 3 days per user spec:
// "nếu còn 3 ngày thì sẽ được chuyển sang trạng thái sắp hết hạn"
export const EXPIRING_SOON_THRESHOLD_MS = 3 * 24 * 3600 * 1000;    // 3 days
export const DEFAULT_PROXY_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days
export const RECENT_MESSAGE_WINDOW_MS = 30 * 60 * 1000;            // 30 minutes
export const DASHBOARD_POLL_INTERVAL_MS = 30_000;                   // 30 seconds

// Proxy Types
export const PROXY_TYPES = ["http", "https", "socks5"] as const;

// Status Colors for UI
export const STATUS_COLORS = {
  available: "default",
  assigned: "secondary",
  expired: "outline",
  banned: "destructive",
  maintenance: "outline",
  active: "default",
  blocked: "destructive",
  pending: "outline",
  approved: "default",
  rejected: "destructive",
  auto_approved: "default",
  cancelled: "secondary",
} as const;
