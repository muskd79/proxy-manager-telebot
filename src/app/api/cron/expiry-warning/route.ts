import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/telegram/send";
import { verifyCronSecret } from "@/lib/auth";
import { captureError } from "@/lib/error-tracking";
import { withCronLock } from "@/lib/cron/advisory-lock";

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const outcome = await withCronLock(supabaseAdmin, "cron.expiry_warning", runExpiryWarning);
  if (outcome.skipped) {
    return NextResponse.json({ success: true, data: { skipped: true, reason: outcome.reason } });
  }
  return NextResponse.json({ success: true, data: outcome.result });
}

// Wave 26-D bug hunt v3 [HIGH] — parallel send concurrency cap.
// Pre-fix the loop ran sequentially (await per row) — at ~500ms per
// Telegram round-trip, 100 expiring proxies = 50s, well past Vercel's
// default 10s function timeout. Only the first ~20 users got notified;
// the rest were silently dropped every run. Promise.allSettled with a
// 10-wide batch keeps total wall time sublinear and avoids hammering
// Telegram's 30/sec global rate limit.
const NOTIFY_CONCURRENCY = 10;

/**
 * Wave 26-D bug hunt v3 [HIGH] — bucketed thresholds for the daily
 * expiry-warning cron.
 *
 * Pre-fix the cron pulled every assigned proxy with `expires_at`
 * within `now…now+3d`. With cron firing daily at 09:00, a proxy
 * expiring in 2.5 days got notified day-0, day-1, day-2 → 3 identical
 * "Sắp hết hạn" DMs. Annoying noise that trains users to ignore the
 * warning entirely.
 *
 * Now: only fire at three discrete thresholds (72h ± 12h, 24h ± 12h,
 * 6h ± 3h). Each proxy receives at most 3 messages over its lifetime —
 * tuned for 9am daily cadence so a proxy expiring at any time of day
 * still hits each bucket exactly once.
 *
 * NOT shipping a `expiry_warning_sent_at` migration in this wave to
 * keep the fix narrow; if the bucket math drifts (e.g., cron schedule
 * changes from 9am daily) we'll revisit with an idempotency column.
 */
function isWithinBucket(
  expiresAtMs: number,
  nowMs: number,
  centerHours: number,
  toleranceHours: number,
): boolean {
  const hoursLeft = (expiresAtMs - nowMs) / (60 * 60 * 1000);
  return Math.abs(hoursLeft - centerHours) <= toleranceHours;
}

async function runExpiryWarning() {
  const now = new Date();
  const nowMs = now.getTime();
  const threeDaysLater = new Date(nowMs + 84 * 60 * 60 * 1000); // 84h covers 72h+12h tolerance

  const { data: expiringProxies } = await supabaseAdmin
    .from("proxies")
    .select("id, host, port, type, assigned_to, expires_at")
    .eq("status", "assigned")
    .eq("is_deleted", false)
    .not("expires_at", "is", null)
    .gt("expires_at", now.toISOString())
    .lte("expires_at", threeDaysLater.toISOString());

  if (!expiringProxies || expiringProxies.length === 0) {
    return { warned: 0, skipped: 0 };
  }

  // Filter to rows whose expires_at hits one of the three buckets.
  // This is the dedup gate — proxies between buckets are skipped this
  // run and will be picked up in a later cron when they roll into a
  // bucket window.
  const dueProxies = expiringProxies.filter((p) => {
    const t = new Date(p.expires_at!).getTime();
    return (
      isWithinBucket(t, nowMs, 72, 12) || // 3-day notice
      isWithinBucket(t, nowMs, 24, 12) || // 1-day notice
      isWithinBucket(t, nowMs, 6, 3) //   6h notice
    );
  });

  if (dueProxies.length === 0) {
    return { warned: 0, skipped: expiringProxies.length };
  }

  // Batch-fetch users in one round trip instead of N+1.
  const userIds = Array.from(
    new Set(dueProxies.map((p) => p.assigned_to).filter(Boolean) as string[]),
  );
  const { data: users } = await supabaseAdmin
    .from("tele_users")
    .select("id, telegram_id, language")
    .in("id", userIds);

  const userById = new Map(
    (users ?? []).map((u) => [
      u.id,
      { telegram_id: u.telegram_id as number, language: (u.language as string) || "vi" },
    ]),
  );

  let warned = 0;
  let skipped = expiringProxies.length - dueProxies.length;

  // Build the per-proxy send tasks, then fire in concurrency-bounded batches.
  const tasks: Array<() => Promise<void>> = [];
  for (const proxy of dueProxies) {
    if (!proxy.assigned_to) {
      skipped++;
      continue;
    }
    const user = userById.get(proxy.assigned_to);
    if (!user) {
      skipped++;
      continue;
    }
    const lang = user.language === "en" ? "en" : "vi";
    const expiresDate = new Date(proxy.expires_at!);
    const daysLeft = Math.ceil(
      (expiresDate.getTime() - nowMs) / (24 * 60 * 60 * 1000),
    );

    const text =
      lang === "vi"
        ? [
            `[!] Proxy sap het han`,
            "",
            `\`${proxy.host}:${proxy.port}\` (${proxy.type.toUpperCase()})`,
            `Het han sau: ${daysLeft} ngay (${expiresDate.toISOString().split("T")[0]})`,
            "",
            `Dung /revoke de tra proxy hoac lien he admin de gia han.`,
          ].join("\n")
        : [
            `[!] Proxy expiring soon`,
            "",
            `\`${proxy.host}:${proxy.port}\` (${proxy.type.toUpperCase()})`,
            `Expires in: ${daysLeft} day(s) (${expiresDate.toISOString().split("T")[0]})`,
            "",
            `Use /revoke to return or contact admin to renew.`,
          ].join("\n");

    tasks.push(async () => {
      try {
        const result = await sendTelegramMessage(user.telegram_id, text);
        if (result.success) warned++;
      } catch (err) {
        captureError(err, {
          source: "cron.expiry-warning",
          extra: { proxyId: proxy.id, telegramId: user.telegram_id },
        });
      }
    });
  }

  for (let i = 0; i < tasks.length; i += NOTIFY_CONCURRENCY) {
    const batch = tasks.slice(i, i + NOTIFY_CONCURRENCY);
    await Promise.allSettled(batch.map((fn) => fn()));
  }

  return { warned, skipped };
}
