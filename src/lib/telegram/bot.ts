import { Bot, webhookCallback } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token || token === "placeholder:token") {
  if (process.env.NODE_ENV === "production") {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured - bot cannot start in production");
  }
  console.warn("TELEGRAM_BOT_TOKEN not configured - bot will not function");
}

export const bot = new Bot(token || "placeholder:token");

export { webhookCallback };
