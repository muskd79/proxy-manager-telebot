import { Bot, webhookCallback } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN || "placeholder:token";

export const bot = new Bot(token);

export { webhookCallback };
