import { NextRequest, NextResponse } from "next/server";
import { webhookCallback } from "@/lib/telegram/bot";
import "@/lib/telegram/handlers"; // register all handlers
import { bot } from "@/lib/telegram/handlers";

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

export async function POST(req: NextRequest) {
  // Verify webhook secret
  if (WEBHOOK_SECRET && WEBHOOK_SECRET.length > 10) {
    const secretHeader = req.headers.get("x-telegram-bot-api-secret-token");
    if (secretHeader !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const handler = webhookCallback(bot, "std/http");
    return await handler(req);
  } catch (error) {
    console.error("Webhook error:", error);
    // Always return 200 to Telegram so it doesn't retry
    return NextResponse.json({ ok: true });
  }
}
