"use client";

/**
 * Wave 26-D-2 — sidebar badge counter for pending warranty claims.
 * Mirror of usePendingRequests() pattern. Uses the same Supabase
 * realtime channel approach so admin sees the queue grow without
 * refresh.
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const NOTIF_KEY = "proxy_manager_warranty_notifications_enabled";

export function usePendingWarranty() {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let prevCount = 0;

    async function fetchCount() {
      const { count: c, error } = await supabase
        .from("warranty_claims")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");

      if (error) {
        console.error("usePendingWarranty fetch error:", error.message);
        setLoading(false);
        return;
      }
      const newCount = c ?? 0;
      // Notification when queue grows (skip initial load).
      if (
        prevCount !== 0 &&
        newCount > prevCount &&
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted" &&
        localStorage.getItem(NOTIF_KEY) !== "false"
      ) {
        try {
          const n = new Notification("Có yêu cầu bảo hành mới", {
            body: `${newCount - prevCount} claim mới đang chờ duyệt`,
            icon: "/favicon.ico",
            tag: "proxy-pending-warranty",
          });
          n.onclick = () => {
            window.focus();
            window.location.href = "/warranty";
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

    void fetchCount();

    const channel = supabase
      .channel("pending-warranty-count")
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "warranty_claims" },
        () => {
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
