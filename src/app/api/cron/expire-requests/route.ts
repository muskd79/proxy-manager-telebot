import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/telegram/send";
import { verifyCronSecret } from "@/lib/auth";
import { captureError } from "@/lib/error-tracking";
import { withCronLock } from "@/lib/cron/advisory-lock";
import type { ProxyRequest, TeleUser } from "@/types/database";

/** Shape returned when proxy_requests is joined with tele_users(telegram_id, language). */
type RequestWithUser = Pick<ProxyRequest, "id" | "tele_user_id" | "proxy_type"> & {
  tele_users: Pick<TeleUser, "telegram_id" | "language"> | null;
};

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const outcome = await withCronLock(supabaseAdmin, "cron.expire_requests", runExpireRequests);
  if (outcome.skipped) {
    return NextResponse.json({ success: true, data: { skipped: true, reason: outcome.reason } });
  }
  return outcome.result;
}

async function runExpireRequests(): Promise<NextResponse> {
  // Expire requests pending for more than 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: expiredRequests } = await supabaseAdmin
    .from("proxy_requests")
    .select("id, tele_user_id, proxy_type, tele_users(telegram_id, language)")
    .eq("status", "pending")
    .eq("is_deleted", false)
    .lt("created_at", sevenDaysAgo.toISOString()) as { data: RequestWithUser[] | null };

  if (!expiredRequests || expiredRequests.length === 0) {
    return NextResponse.json({ success: true, data: { expired: 0 } });
  }

  // Phase 1B (B-013) — race fix. Pre-fix UPDATE didn't filter
  // status=pending; if admin approved a request between our SELECT
  // (line 30) and the UPDATE here, we would flip the now-approved
  // row back to expired and orphan the assigned proxy. Add the
  // filter + RETURNING so we only notify users whose row was
  // actually expired by THIS cron tick.
  const ids = expiredRequests.map((r) => r.id);
  const { data: actuallyExpired } = await supabaseAdmin
    .from("proxy_requests")
    .update({ status: "expired", processed_at: new Date().toISOString() })
    .in("id", ids)
    .eq("status", "pending")
    .select("id");
  const actuallyExpiredIds = new Set((actuallyExpired ?? []).map((r) => r.id));

  // Phase 1B (B-020 follow-up) — port concurrency cap from
  // expire-proxies. Pre-fix sequential `for await` could exceed
  // Lambda timeout when expired count went into the hundreds.
  const CONCURRENCY = 10;
  let notified = 0;
  const targets = expiredRequests.filter(
    (r) => r.tele_users?.telegram_id && actuallyExpiredIds.has(r.id),
  );
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const chunk = targets.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      chunk.map(async (req) => {
        const user = req.tele_users!;
        const lang = user.language || "en";
        const type = req.proxy_type?.toUpperCase() || "ANY";
        const text =
          lang === "vi"
            ? `[i] Yêu cầu proxy ${type} đã hết hạn sau 7 ngày không được duyệt.\nGửi /getproxy để yêu cầu mới.`
            : `[i] Your ${type} proxy request expired after 7 days without approval.\nUse /getproxy to request again.`;
        try {
          await sendTelegramMessage(user.telegram_id, text);
          notified++;
        } catch (err) {
          captureError(err, {
            source: "cron.expire-requests",
            extra: { requestId: req.id, telegramId: user.telegram_id },
          });
        }
      }),
    );
  }

  return NextResponse.json({
    success: true,
    data: { expired: actuallyExpiredIds.size, notified },
  });
}
