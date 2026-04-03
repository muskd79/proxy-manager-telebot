import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/telegram/send";
import { verifyCronSecret } from "@/lib/auth";
import { captureError } from "@/lib/error-tracking";

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  // Find proxies expiring in next 3 days that haven't been warned yet
  const now = new Date();
  const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const { data: expiringProxies } = await supabaseAdmin
    .from("proxies")
    .select("id, host, port, type, assigned_to, expires_at")
    .eq("status", "assigned")
    .eq("is_deleted", false)
    .not("expires_at", "is", null)
    .gt("expires_at", now.toISOString())
    .lte("expires_at", threeDaysLater.toISOString());

  if (!expiringProxies || expiringProxies.length === 0) {
    return NextResponse.json({ success: true, data: { warned: 0 } });
  }

  let warned = 0;

  for (const proxy of expiringProxies) {
    if (!proxy.assigned_to) continue;

    const { data: user } = await supabaseAdmin
      .from("tele_users")
      .select("telegram_id, language")
      .eq("id", proxy.assigned_to)
      .single();

    if (!user) continue;

    const lang = user.language || "vi";
    const expiresDate = new Date(proxy.expires_at!);
    const daysLeft = Math.ceil((expiresDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

    const text = lang === "vi"
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

    try {
      const result = await sendTelegramMessage(user.telegram_id, text);
      if (result.success) warned++;
    } catch (err) {
      captureError(err, { source: "cron.expiry-warning", extra: { proxyId: proxy.id, telegramId: user.telegram_id } });
    }
  }

  return NextResponse.json({ success: true, data: { warned } });
}
