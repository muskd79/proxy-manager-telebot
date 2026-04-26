import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret } from "@/lib/auth";
import { sendTelegramMessage } from "@/lib/telegram/send";
import { logActivity } from "@/lib/logger";

/**
 * GET /api/cron/lot-expiry-alert
 *
 * Hourly cron. Queries the `expiring_soon_lots` view (mig 026) for
 * lots that need an alert in their current window (24h/7d/30d), sends
 * one Telegram message per lot to every admin chat, and updates the
 * matching `last_alert_*_at` column to suppress duplicates within
 * the same window.
 *
 * Per-window dedup is in the view's WHERE clause; a row only appears
 * if `last_alert_<window>_at` is NULL or older than (window - 1h).
 *
 * Auth: shared CRON_SECRET (Wave 18B timing-safe compare reused).
 */

interface ExpiringLot {
  id: string;
  vendor_label: string;
  expiry_date: string;
  total_cost_usd: number | null;
  currency: string;
  proxy_count: number;
  batch_reference: string | null;
  alert_window: "24h" | "7d" | "30d" | null;
}

export async function GET(request: NextRequest) {
  const authErr = verifyCronSecret(request);
  if (authErr) return authErr;

  try {
    const { data: lots, error } = await supabaseAdmin
      .from("expiring_soon_lots")
      .select("*")
      .not("alert_window", "is", null)
      .order("expiry_date", { ascending: true })
      .limit(50);

    if (error) {
      console.error("lot-expiry-alert query error:", error.message);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const rows = (lots ?? []) as ExpiringLot[];
    if (rows.length === 0) {
      return NextResponse.json({ success: true, alerted: 0 });
    }

    // Fetch admin telegram_id list once. Admins are authoritative recipients
    // (vs bot users) because lot expiry is operational, not customer-facing.
    const { data: admins } = await supabaseAdmin
      .from("admins")
      .select("telegram_id")
      .eq("is_active", true)
      .not("telegram_id", "is", null);

    const adminChatIds = (admins ?? [])
      .map((a) => (a as { telegram_id: number | null }).telegram_id)
      .filter((id): id is number => typeof id === "number");

    let alerted = 0;
    for (const lot of rows) {
      const hoursLeft = Math.max(
        0,
        Math.round((new Date(lot.expiry_date).getTime() - Date.now()) / 3600_000),
      );
      const cost = lot.total_cost_usd != null
        ? `${lot.currency} ${lot.total_cost_usd.toFixed(2)}`
        : "—";
      const text = [
        `[!] Lot expiring soon`,
        `Vendor: ${lot.vendor_label}`,
        `Proxies: ${lot.proxy_count}`,
        `Cost: ${cost}`,
        lot.batch_reference ? `Batch: ${lot.batch_reference}` : null,
        `Hours left: ${hoursLeft}`,
        `Window: ${lot.alert_window}`,
      ]
        .filter(Boolean)
        .join("\n");

      // Fire-and-forget per admin so one failure doesn't block the rest.
      for (const chatId of adminChatIds) {
        sendTelegramMessage(chatId, text).catch((e) =>
          console.error(`alert delivery to ${chatId} failed:`, e instanceof Error ? e.message : String(e)),
        );
      }

      // Mark this window as fired so the view filters this lot out next tick.
      const col = lot.alert_window === "24h"
        ? "last_alert_24h_at"
        : lot.alert_window === "7d"
          ? "last_alert_7d_at"
          : "last_alert_30d_at";
      await supabaseAdmin
        .from("purchase_lots")
        .update({ [col]: new Date().toISOString() })
        .eq("id", lot.id);

      alerted += 1;
    }

    logActivity({
      actorType: "system",
      action: "lot.expiry.alert",
      details: { alerted, total_candidates: rows.length },
    }).catch(() => {});

    return NextResponse.json({ success: true, alerted, candidates: rows.length });
  } catch (err) {
    console.error("lot-expiry-alert unexpected:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: "Internal error" }, { status: 500 });
  }
}
