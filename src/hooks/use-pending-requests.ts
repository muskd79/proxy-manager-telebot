"use client";

import { useRealtimeCount } from "./use-realtime-count";

/**
 * Wave 22O — Realtime hook đếm số `proxy_requests` đang `pending`.
 *
 * Dùng trong sidebar để render badge count + trigger browser
 * notification khi có request mới. UI/UX agent đã flag:
 *   "/admins page: no realtime sync — admin phải vào /requests
 *    để biết có pending. Miss request = user wait = user complain."
 *
 * Wave 27 craft v3 — extracted shared subscribe/debounce/notification
 * logic into useRealtimeCount. The strategy below is preserved as-is:
 *
 * Strategy:
 *   1. Initial fetch của count khi mount.
 *   2. Realtime subscribe `proxy_requests` postgres_changes (INSERT
 *      + UPDATE) — refetch count on each event (debounced ~300ms).
 *   3. Khi count tăng từ N → N+1 (request mới đến), trigger
 *      `Notification` API.
 *   4. Cleanup subscription on unmount.
 *
 * Browser notification:
 *   - Yêu cầu permission lần đầu user mount component (qua helper
 *     `requestNotificationPermission`).
 *   - Hiển thị "Có yêu cầu proxy mới" với click → navigate /requests.
 *   - Tab inactive → vẫn show (browser-level).
 *   - Admin có thể disable trong /settings.
 */

const NOTIF_KEY = "proxy_manager_notifications_enabled";

export function usePendingRequests() {
  return useRealtimeCount({
    table: "proxy_requests",
    // is_deleted=false ensures soft-deleted (trash) rows don't bump
    // the badge — they're not actionable from the queue view.
    filters: { status: "pending", is_deleted: false },
    channelName: "pending-requests-count",
    notification: {
      storageKey: NOTIF_KEY,
      title: "Yêu cầu proxy mới",
      body: (delta) => `Có ${delta} yêu cầu mới đang chờ duyệt`,
      tag: "proxy-pending-request",
      href: "/requests",
    },
  });
}

/**
 * Helper: yêu cầu permission notification từ browser.
 * Gọi từ /settings hoặc admin click "Bật thông báo".
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function isNotificationEnabled(): boolean {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission !== "granted") return false;
  return localStorage.getItem(NOTIF_KEY) !== "false";
}

export function setNotificationEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(NOTIF_KEY, enabled ? "true" : "false");
}
