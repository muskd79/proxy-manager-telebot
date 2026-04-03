// Pagination
export const PAGE_SIZES = [20, 50, 100, 500] as const;
export const DEFAULT_PAGE_SIZE = 20;

// Rate Limiting
export const API_RATE_LIMIT_PER_MINUTE = 100;
export const API_RATE_LIMIT_WINDOW_MS = 60_000;

// Proxy
export const HEALTH_CHECK_TIMEOUT_MS = 10_000;
export const HEALTH_CHECK_CONCURRENCY = 50;
export const IMPORT_BATCH_SIZE = 100;

// Health Check Cron
export const HEALTH_CHECK_CRON_BATCH_SIZE = 500;

// Trash
export const TRASH_AUTO_CLEAN_DAYS = 30;

// Bot
export const BOT_COMMANDS = [
  { command: "start", description_vi: "Bat dau va dang ky", description_en: "Start and register" },
  { command: "getproxy", description_vi: "Yeu cau proxy moi", description_en: "Request a new proxy" },
  { command: "myproxies", description_vi: "Xem proxy cua ban", description_en: "View your proxies" },
  { command: "status", description_vi: "Trang thai tai khoan", description_en: "Account status" },
  { command: "help", description_vi: "Huong dan su dung", description_en: "Help" },
  { command: "language", description_vi: "Doi ngon ngu", description_en: "Change language" },
  { command: "cancel", description_vi: "Huy yeu cau dang cho", description_en: "Cancel pending requests" },
  { command: "revoke", description_vi: "Tra proxy", description_en: "Return proxy" },
] as const;

// UI
export const SIDEBAR_WIDTH = 240;
export const SIDEBAR_COLLAPSED_WIDTH = 64;

// Analytics
export const ANALYTICS_DAYS = 14;

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
