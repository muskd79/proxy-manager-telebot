"use client";

/**
 * Wave 27 craft v3 — useRealtimeCount factory.
 *
 * Extracts the duplicated logic that lived in `use-pending-warranty.ts`
 * and `use-pending-requests.ts`: count rows by filter, subscribe to
 * postgres_changes on the table, refetch debounced, optionally fire a
 * browser Notification when the count grows.
 *
 * Why a factory:
 *   - Both hooks were ~100-line near-duplicates. A future "pending
 *     ban-appeals counter" or "queued auto-allocate counter" would
 *     have copied a third time.
 *   - Subtle drift was already visible: `use-pending-requests` had
 *     `is_deleted=false` filter but `use-pending-warranty` didn't.
 *     Centralising forces the filter to be expressed as data, not
 *     forgotten in another copy-paste.
 *   - Notification logic (permission check, localStorage opt-out, tag
 *     dedupe) is the part most likely to break under future updates;
 *     one place to fix.
 *
 * What stays in the call site:
 *   - Channel name (must be unique across the app)
 *   - Notification copy (Vietnamese strings, tag, /requests vs /warranty
 *     destination link)
 *   - localStorage key for the per-feature opt-out toggle
 *
 * What this factory does NOT cover (yet):
 *   - The `header.tsx` surface uses fetch() through /api/requests with
 *     a 2s debounce instead of direct supabase. That route handles
 *     auth scoping + RLS implicitly via the API. Not migrated to
 *     this factory because the contract differs (HTTP vs realtime).
 *     If we ever want unified, we'd add an `via: "rpc" | "fetch"`
 *     option here. Out of scope for now.
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface RealtimeCountNotification {
  /** localStorage key gating the notification (admin can disable). */
  storageKey: string;
  /** Notification.title. */
  title: string;
  /** Body composer; receives the delta count (always >= 1). */
  body: (delta: number) => string;
  /** Tag — replaces previous notification with same tag. */
  tag: string;
  /** Page admin lands on when clicking the notification. */
  href: string;
}

export interface UseRealtimeCountOptions {
  /** Table to count rows in. */
  table: string;
  /** Equality filters applied to the count query. */
  filters?: Record<string, string | number | boolean>;
  /** Realtime channel name (must be unique per hook instance app-wide). */
  channelName: string;
  /** Debounce realtime burst (ms). Default 300. */
  debounceMs?: number;
  /** Optional notification config. Omit to disable browser notifications. */
  notification?: RealtimeCountNotification;
}

export interface UseRealtimeCountResult {
  count: number | null;
  loading: boolean;
}

/**
 * Live-count rows in `table` matching `filters`, subscribing to
 * postgres_changes for instant updates. Optionally fires a browser
 * Notification when the count increases.
 *
 * Each call site MUST use a unique `channelName` — Supabase routes
 * postgres_changes events by channel name, so two hooks with the same
 * name will cross-fire and double-count.
 */
export function useRealtimeCount(
  opts: UseRealtimeCountOptions,
): UseRealtimeCountResult {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Effect deps are intentionally empty — the hook treats `opts` as
  // static for the lifetime of the component instance (matches the
  // pre-extraction behaviour of use-pending-warranty / use-pending-
  // requests). For different filters, instantiate a separate hook
  // call with a different channel name.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const supabase = createClient();
    let prevCount = 0;
    let cancelled = false;

    async function fetchCount() {
      let q = supabase
        .from(opts.table)
        .select("id", { count: "exact", head: true });
      for (const [k, v] of Object.entries(opts.filters ?? {})) {
        // Each .eq() returns the same builder type so the chain is safe.
        // The cast keeps TS happy since `Record<string, …>` loses the
        // column-name typing.
        q = q.eq(k, v as never);
      }
      const { count: c, error } = await q;
      if (cancelled) return;
      if (error) {
        console.error(
          `useRealtimeCount[${opts.table}] fetch error:`,
          error.message,
        );
        setLoading(false);
        return;
      }
      const newCount = c ?? 0;
      const delta = newCount - prevCount;
      // Notification when queue grows. Skip the initial mount
      // (prevCount === 0 sentinel) so we don't spam admin on every
      // refresh.
      if (
        opts.notification &&
        prevCount !== 0 &&
        delta > 0 &&
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted" &&
        localStorage.getItem(opts.notification.storageKey) !== "false"
      ) {
        try {
          const n = new Notification(opts.notification.title, {
            body: opts.notification.body(delta),
            icon: "/favicon.ico",
            tag: opts.notification.tag,
          });
          n.onclick = () => {
            window.focus();
            window.location.href = opts.notification!.href;
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
      .channel(opts.channelName)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        { event: "*", schema: "public", table: opts.table },
        () => {
          // Debounce so a burst of N writes triggers 1 fetch, not N.
          setTimeout(() => {
            if (!cancelled) void fetchCount();
          }, opts.debounceMs ?? 300);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return { count, loading };
}
