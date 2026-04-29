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

  // Mark as expired
  const ids = expiredRequests.map((r) => r.id);
  await supabaseAdmin
    .from("proxy_requests")
    .update({ status: "expired", processed_at: new Date().toISOString() })
    .in("id", ids);

  // Notify users
  let notified = 0;
  for (const req of expiredRequests) {
    const user = req.tele_users;
    if (!user?.telegram_id) continue;

    const lang = user.language || "en";
    const type = req.proxy_type?.toUpperCase() || "ANY";
    const text =
      lang === "vi"
        ? `[i] Yeu cau proxy ${type} da het han sau 7 ngay khong duoc duyet.\nGui /getproxy de yeu cau moi.`
        : `[i] Your ${type} proxy request expired after 7 days without approval.\nUse /getproxy to request again.`;

    await sendTelegramMessage(user.telegram_id, text).catch((err) =>
      captureError(err, { source: "cron.expire-requests", extra: { requestId: req.id, telegramId: user.telegram_id } })
    );
    notified++;
  }

  return NextResponse.json({
    success: true,
    data: { expired: expiredRequests.length, notified },
  });
}
