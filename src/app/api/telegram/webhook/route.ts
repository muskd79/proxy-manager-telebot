import { NextRequest, NextResponse } from "next/server";
import { webhookCallback } from "@/lib/telegram/bot";
import "@/lib/telegram/handlers"; // register all handlers
import { bot } from "@/lib/telegram/handlers";

export async function GET() {
  return NextResponse.json({ status: "ok", webhook: "active" });
}

export async function POST(req: NextRequest) {
  try {
    const handler = webhookCallback(bot, "std/http");
    return await handler(req);
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ ok: true });
  }
}
