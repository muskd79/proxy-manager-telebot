/**
 * Wave 26-D — single helper to write rows into `proxy_events`.
 *
 * Pre-fix codebase had 9 different action strings split across
 * activity_logs writes (proxy.create / proxy.update / etc) AND bot
 * logActivity() calls (proxy_auto_assigned / proxy_revoked / etc) —
 * inconsistent format, hard to query "all events for proxy X".
 *
 * `proxy_events` (mig 057) consolidates lifecycle events. This helper:
 *   - takes a typed event_type (compile-time guard against typos)
 *   - normalises actor_type from the calling context
 *   - upserts via service role (bypasses RLS — events table has no RLS)
 *   - never throws on logging failure (best-effort — return null
 *     instead so the caller's primary write doesn't get rolled back
 *     by an audit hiccup)
 *
 * Usage from API route:
 *   await logProxyEvent({
 *     proxy_id: id,
 *     event_type: "edited",
 *     actor_type: "admin",
 *     actor_id: admin.id,
 *     details: { fields: ["status", "country"] },
 *   });
 *
 * Usage from bot:
 *   await logProxyEvent({
 *     proxy_id: proxy.id,
 *     event_type: "reported_broken",
 *     actor_type: "tele_user",
 *     actor_id: user.id,
 *     related_user_id: user.id,
 *     details: { reason_code, reason_text },
 *   });
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ProxyEventType } from "@/types/database";
import { captureError } from "@/lib/error-tracking";

export interface LogProxyEventArgs {
  proxy_id: string;
  event_type: ProxyEventType;
  actor_type?: "admin" | "tele_user" | "system" | "bot" | null;
  actor_id?: string | null;
  /** "ai dùng proxy này khi sự kiện xảy ra" — for assigned/unassigned events. */
  related_user_id?: string | null;
  /** Cross-link to the OTHER proxy in the event (e.g. warranty replacement). */
  related_proxy_id?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Insert a row into proxy_events. Returns the inserted row id on success,
 * or null if the write failed. Never throws — failures are logged via
 * captureError so the calling business logic doesn't roll back on audit
 * trail glitch.
 */
export async function logProxyEvent(
  args: LogProxyEventArgs,
): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("proxy_events")
      .insert({
        proxy_id: args.proxy_id,
        event_type: args.event_type,
        actor_type: args.actor_type ?? null,
        actor_id: args.actor_id ?? null,
        related_user_id: args.related_user_id ?? null,
        related_proxy_id: args.related_proxy_id ?? null,
        details: args.details ?? {},
      })
      .select("id")
      .single();

    if (error) {
      captureError(new Error(error.message), {
        source: "proxy_events.insert",
        extra: {
          proxy_id: args.proxy_id,
          event_type: args.event_type,
        },
      });
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    captureError(err, {
      source: "proxy_events.insert.unexpected",
      extra: {
        proxy_id: args.proxy_id,
        event_type: args.event_type,
      },
    });
    return null;
  }
}

/**
 * Wave 26-D — convenience: log an "edited" event with structured
 * before/after diff. Used by api/proxies PATCH so the timeline shows
 * "expires_at đổi từ 2026-05-15 sang 2026-05-30" rather than just
 * "Sửa proxy".
 *
 * `before` and `after` are partial proxy snapshots; the helper computes
 * the diff (only fields that actually changed) and stores it in
 * `details.diff`.
 */
export async function logProxyEdit(
  proxyId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  actor: { type: "admin" | "tele_user" | "system" | "bot"; id: string | null },
): Promise<string | null> {
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of allKeys) {
    const b = before[k];
    const a = after[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      diff[k] = { before: b, after: a };
    }
  }
  // Skip the event if nothing actually changed — happens when caller
  // PATCHes with values identical to current state.
  if (Object.keys(diff).length === 0) return null;

  return logProxyEvent({
    proxy_id: proxyId,
    event_type: "edited",
    actor_type: actor.type,
    actor_id: actor.id,
    details: { diff, fields: Object.keys(diff) },
  });
}
