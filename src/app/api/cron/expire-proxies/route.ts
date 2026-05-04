import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/telegram/send";
import { verifyCronSecret } from "@/lib/auth";
import { captureError } from "@/lib/error-tracking";
import { withCronLock } from "@/lib/cron/advisory-lock";

/**
 * Cron: expire assigned proxies whose expires_at is in the past.
 *
 * Wave 22E-2 BUG FIX (B1, severity HIGH):
 *
 * Pre-fix code did `for (proxy of expiredProxies) { await UPDATE; await
 * SELECT user; await sendTelegram }` — purely sequential. With 500
 * expired proxies + 1s Telegram round-trip, the cron exceeded Vercel's
 * 10-second function timeout and the remaining proxies stayed assigned
 * past their expiry.
 *
 * The fix: one batch UPDATE for all expired proxies (1 SQL call total),
 * then `Promise.allSettled` over Telegram notifications with a parallel
 * cap so we don't hammer Telegram's per-bot rate limit.
 *
 * Worst-case timing now:
 *   1 batch UPDATE  ~= 50-200 ms
 *   1 batch SELECT users  ~= 50-100 ms
 *   N parallel Telegram sends with concurrency=10 → ~ceil(N/10)*1000 ms
 * For N=500 that's ~50s → still over budget BUT we ack the batch update
 * BEFORE the notifications, so the DB state is correct even if the cron
 * is killed mid-notify. Telegram retries on next tick are idempotent
 * (the message is informational; duplicate notifications are an
 * accepted UX trade-off vs the previous "proxy stuck assigned past
 * expiry" data-correctness bug).
 */

const NOTIFY_CONCURRENCY = 10;

interface ExpiredProxy {
  id: string;
  assigned_to: string | null;
  host: string;
  port: number;
  type: string;
  expires_at: string | null;
}

interface UserNotifyTarget {
  telegram_id: number | null;
  language: string | null;
}

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const outcome = await withCronLock(supabaseAdmin, "cron.expire_proxies", runExpireProxies);
  if (outcome.skipped) {
    return NextResponse.json({ success: true, data: { skipped: true, reason: outcome.reason } });
  }
  return outcome.result;
}

async function runExpireProxies(): Promise<NextResponse> {
  const now = new Date().toISOString();

  // 1. Find all expired-assigned proxies in one query.
  //
  // Wave 27 bug hunt v7 [debugger #2, HIGH] — also pick up
  // `reported_broken` rows whose expires_at is past. Pre-fix the
  // SELECT was `.eq("status", "assigned")` only; reported_broken
  // proxies (warranty pending) silently never expired. Mig 063
  // updated safe_expire_proxies to also handle reported_broken;
  // the SELECT here mirrors the widening.
  const { data: expiredProxies, error: selectErr } = await supabaseAdmin
    .from("proxies")
    .select("id, assigned_to, host, port, type, expires_at")
    .in("status", ["assigned", "reported_broken"])
    .eq("is_deleted", false)
    .lt("expires_at", now)
    .not("expires_at", "is", null);

  if (selectErr) {
    captureError(selectErr, { source: "cron.expire-proxies.select" });
    return NextResponse.json(
      { success: false, error: "Failed to query expired proxies" },
      { status: 500 },
    );
  }

  const rows = (expiredProxies ?? []) as ExpiredProxy[];
  if (rows.length === 0) {
    return NextResponse.json({ success: true, data: { expired: 0, notified: 0 } });
  }

  // 2. Atomic batch expire + tele_users counter decrement via RPC.
  //    Wave 22E-5 BUG FIX (A6): pre-fix UPDATE marked proxies expired but
  //    did NOT decrement tele_users.proxies_used_total. Users had inflated
  //    counters until the hourly/daily reset window, possibly blocking new
  //    /getproxy requests for hours. The new safe_expire_proxies RPC
  //    (mig 031) wraps both writes in one transaction.
  const ids = rows.map((r) => r.id);
  const { data: rpcData, error: updateErr } = await supabaseAdmin.rpc(
    "safe_expire_proxies",
    { p_proxy_ids: ids },
  );

  if (updateErr) {
    captureError(updateErr, { source: "cron.expire-proxies.rpc" });
    return NextResponse.json(
      { success: false, error: "Failed to expire proxies" },
      { status: 500 },
    );
  }

  const rpcResult = rpcData as { expired: number; users_decremented: number } | null;
  const count = rpcResult?.expired ?? 0;

  // 3. Resolve Telegram chat IDs for the notify fan-out. ONE SELECT.
  const userIds = Array.from(new Set(rows.map((r) => r.assigned_to).filter((id): id is string => !!id)));
  const userMap = new Map<string, UserNotifyTarget>();
  if (userIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from("tele_users")
      .select("id, telegram_id, language")
      .in("id", userIds);
    for (const u of users ?? []) {
      userMap.set((u as { id: string }).id, {
        telegram_id: (u as UserNotifyTarget).telegram_id ?? null,
        language: (u as UserNotifyTarget).language ?? null,
      });
    }
  }

  // 4. Fan-out Telegram notifications with bounded concurrency.
  const notifyTasks: Array<() => Promise<unknown>> = [];
  for (const proxy of rows) {
    if (!proxy.assigned_to) continue;
    const u = userMap.get(proxy.assigned_to);
    if (!u?.telegram_id) continue;

    const lang = u.language || "vi";
    const text = lang === "vi"
      ? `[!] Proxy het han\n\nProxy ${proxy.host}:${proxy.port} (${proxy.type}) da het han va bi thu hoi.`
      : `[!] Proxy expired\n\nProxy ${proxy.host}:${proxy.port} (${proxy.type}) has expired and been revoked.`;

    notifyTasks.push(() =>
      sendTelegramMessage(u.telegram_id as number, text).catch((err) =>
        captureError(err, {
          source: "cron.expire-proxies.notify",
          extra: { proxyId: proxy.id, telegramId: u.telegram_id },
        }),
      ),
    );
  }

  let notified = 0;
  for (let i = 0; i < notifyTasks.length; i += NOTIFY_CONCURRENCY) {
    const batch = notifyTasks.slice(i, i + NOTIFY_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((t) => t()));
    notified += results.filter((r) => r.status === "fulfilled").length;
  }

  return NextResponse.json({
    success: true,
    data: {
      expired: count,
      notified,
      users_decremented: rpcResult?.users_decremented ?? 0,
    },
  });
}
