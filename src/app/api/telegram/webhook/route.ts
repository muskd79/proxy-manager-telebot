import { NextRequest, NextResponse } from "next/server";
import { webhookCallback } from "@/lib/telegram/bot";
import "@/lib/telegram/handlers"; // register all handlers
import { bot } from "@/lib/telegram/handlers";

// Simple dedup: track last 1000 processed update_ids
const processedUpdates = new Set<number>();
const MAX_DEDUP_SIZE = 1000;

export async function GET() {
  return NextResponse.json({ status: "ok", webhook: "active" });
}

export async function POST(req: NextRequest) {
  // Verify Telegram webhook secret (required)
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("TELEGRAM_WEBHOOK_SECRET not configured");
    return NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 500 });
  }

  const headerSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (headerSecret !== webhookSecret) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  try {
    const body = await req.clone().json();
    const updateId = body?.update_id;

    // Dedup check
    if (updateId && processedUpdates.has(updateId)) {
      return NextResponse.json({ ok: true }); // Already processed
    }

    if (updateId) {
      processedUpdates.add(updateId);
      // Keep set bounded
      if (processedUpdates.size > MAX_DEDUP_SIZE) {
        const first = processedUpdates.values().next().value;
        if (first !== undefined) processedUpdates.delete(first);
      }
    }

    const handler = webhookCallback(bot, "std/http");
    return await handler(req);
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ ok: true });
  }
}
