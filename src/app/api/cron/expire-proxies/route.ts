import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
  const token = process.env.TELEGRAM_BOT_TOKEN;

  for (const proxy of expiredProxies) {
    // Revoke proxy
    await supabaseAdmin
      .from("proxies")
      .update({ status: "expired", assigned_to: null, assigned_at: null })
      .eq("id", proxy.id);

    expired++;

    // Notify user if possible
    if (proxy.assigned_to && token && !token.startsWith("placeholder")) {
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

        fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: user.telegram_id, text }),
        }).catch(console.error);
      }
    }
  }

  return NextResponse.json({ success: true, data: { expired } });
}
