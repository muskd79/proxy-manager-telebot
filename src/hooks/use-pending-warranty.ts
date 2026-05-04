"use client";

/**
 * Wave 26-D-2 — sidebar badge counter for pending warranty claims.
 * Mirror of usePendingRequests() pattern. Uses the same Supabase
 * realtime channel approach so admin sees the queue grow without
 * refresh.
 *
 * Wave 27 craft v3 — extracted shared logic into useRealtimeCount.
 * This file is now a 20-line wrapper that just configures the
 * factory; everything in the box (subscribe, debounce, notification,
 * cleanup) lives in `use-realtime-count.ts`.
 */

import { useRealtimeCount } from "./use-realtime-count";

const NOTIF_KEY = "proxy_manager_warranty_notifications_enabled";

export function usePendingWarranty() {
  return useRealtimeCount({
    table: "warranty_claims",
    filters: { status: "pending" },
    channelName: "pending-warranty-count",
    notification: {
      storageKey: NOTIF_KEY,
      title: "Có yêu cầu bảo hành mới",
      body: (delta) => `${delta} claim mới đang chờ duyệt`,
      tag: "proxy-pending-warranty",
      href: "/warranty",
    },
  });
}
