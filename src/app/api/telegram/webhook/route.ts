import { NextRequest, NextResponse } from "next/server";
import { webhookCallback } from "@/lib/telegram/bot";
import "@/lib/telegram/handlers"; // register all handlers
import { bot } from "@/lib/telegram/handlers";

export async function GET() {
  return NextResponse.json({ status: "ok", webhook: "active" });
}

export async function POST(req: NextRequest) {
  // Verify Telegram webhook secret
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (webhookSecret) {
    const headerSecret = req.headers.get("x-telegram-bot-api-secret-token");
    if (headerSecret !== webhookSecret) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }
  }

  try {
    const handler = webhookCallback(bot, "std/http");
    return await handler(req);
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ ok: true });
  }
}
