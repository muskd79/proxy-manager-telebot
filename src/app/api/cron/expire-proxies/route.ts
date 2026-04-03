import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/telegram/send";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("CRON_SECRET not configured");
    return NextResponse.json({ success: false, error: "Server misconfigured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();

  // Find expired proxies that are still assigned
  const { data: expiredProxies } = await supabaseAdmin
    .from("proxies")
    .select("id, assigned_to, host, port, type, expires_at")
    .eq("status", "assigned")
    .eq("is_deleted", false)
    .lt("expires_at", now)
    .not("expires_at", "is", null);

  if (!expiredProxies || expiredProxies.length === 0) {
    return NextResponse.json({ success: true, data: { expired: 0 } });
  }

  let expired = 0;

  for (const proxy of expiredProxies) {
    // Revoke proxy
    await supabaseAdmin
      .from("proxies")
      .update({ status: "expired", assigned_to: null, assigned_at: null })
      .eq("id", proxy.id);

    expired++;

    // Notify user if possible
    if (proxy.assigned_to) {
      const { data: user } = await supabaseAdmin
        .from("tele_users")
        .select("telegram_id, language")
        .eq("id", proxy.assigned_to)
        .single();

      if (user) {
        const lang = user.language || "vi";
        const text = lang === "vi"
          ? `[!] Proxy het han\n\nProxy ${proxy.host}:${proxy.port} (${proxy.type}) da het han va bi thu hoi.`
          : `[!] Proxy expired\n\nProxy ${proxy.host}:${proxy.port} (${proxy.type}) has expired and been revoked.`;

        await sendTelegramMessage(user.telegram_id, text).catch(console.error);
      }
    }
  }

  return NextResponse.json({ success: true, data: { expired } });
}
