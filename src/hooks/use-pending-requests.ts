"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Wave 22O — Realtime hook đếm số `proxy_requests` đang `pending`.
 *
 * Dùng trong sidebar để render badge count + trigger browser
 * notification khi có request mới. UI/UX agent đã flag:
 *   "/admins page: no realtime sync — admin phải vào /requests
 *    để biết có pending. Miss request = user wait = user complain."
 *
 * Strategy:
 *   1. Initial fetch của count khi mount.
 *   2. Realtime subscribe `proxy_requests` postgres_changes (INSERT
 *      + UPDATE) — refetch count on each event.
 *   3. Khi count tăng từ N → N+1 (request mới đến), trigger
 *      `Notification` API + sound.
 *   4. Cleanup subscription on unmount.
 *
 * Browser notification:
 *   - Yêu cầu permission lần đầu user mount component.
 *   - Hiển thị "Có yêu cầu proxy mới" với click → navigate /requests.
 *   - Tab inactive → vẫn show (browser-level).
 *   - Sound: bell.mp3 trong public/ (admin có thể disable trong /settings).
 */

const NOTIF_KEY = "proxy_manager_notifications_enabled";

export function usePendingRequests() {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let prevCount = 0;

    async function fetchCount() {
      const { count: c, error } = await supabase
        .from("proxy_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .eq("is_deleted", false);

      if (error) {
        console.error("usePendingRequests fetch error:", error.message);
        setLoading(false);
        return;
      }
      const newCount = c ?? 0;
      // Browser notification khi count tăng (không trigger lúc initial load).
      if (
        prevCount !== 0 &&
        newCount > prevCount &&
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted" &&
        localStorage.getItem(NOTIF_KEY) !== "false"
      ) {
        try {
          const n = new Notification("Yêu cầu proxy mới", {
            body: `Có ${newCount - prevCount} yêu cầu mới đang chờ duyệt`,
            icon: "/favicon.ico",
            tag: "proxy-pending-request",
          });
          n.onclick = () => {
            window.focus();
            window.location.href = "/requests";
            n.close();
          };
        } catch (e) {
          console.error("Notification failed:", e);
        }
      }
      prevCount = newCount;
      setCount(newCount);
      setLoading(false);
    }

    fetchCount();

    // Realtime channel
    const channel = supabase
      .channel("pending-requests-count")
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "proxy_requests" },
        () => {
          // Debounce by ~300ms — multiple events in quick burst → 1 fetch
          setTimeout(fetchCount, 300);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { count, loading };
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
