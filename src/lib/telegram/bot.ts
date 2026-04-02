import { Bot, webhookCallback } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token || token === "placeholder:token") {
  console.warn("TELEGRAM_BOT_TOKEN not configured - bot will not function");
}

export const bot = new Bot(token || "placeholder:token");

export { webhookCallback };
