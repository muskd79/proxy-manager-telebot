import type { InlineKeyboard } from "grammy";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // exponential backoff

interface SendResult {
  success: boolean;
  error?: string;
}

export async function sendTelegramMessage(
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboard | { parse_mode?: string }
): Promise<SendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.startsWith("placeholder")) {
    return { success: false, error: "Bot token not configured" };
  }

  // Determine parse_mode and reply_markup from the overloaded parameter
  let parseMode = "Markdown";
  let inlineKeyboard: InlineKeyboard | undefined;

  if (replyMarkup && typeof replyMarkup === "object") {
    if ("parse_mode" in replyMarkup && !("toTransitiveArray" in replyMarkup)) {
      // Legacy options object: { parse_mode?: string }
      parseMode = (replyMarkup as { parse_mode?: string }).parse_mode || "Markdown";
    } else {
      // InlineKeyboard instance (has toTransitiveArray method from grammy)
      inlineKeyboard = replyMarkup as InlineKeyboard;
    }
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const bodyObj: Record<string, unknown> = {
        chat_id: chatId,
        text,
        parse_mode: parseMode,
      };

      if (inlineKeyboard) {
        bodyObj.reply_markup = inlineKeyboard;
      }

      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj),
      });

      if (res.ok) return { success: true };

      const data = await res.json().catch(() => ({}));

      // Don't retry on permanent errors
      if (res.status === 400 || res.status === 403 || res.status === 404) {
        return { success: false, error: `Telegram API ${res.status}: ${data.description || "Unknown"}` };
      }

      // Retry on temporary errors (429, 500, 502, 503)
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }

      return { success: false, error: `Telegram API ${res.status} after ${MAX_RETRIES} retries` };
    } catch (err) {
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      return { success: false, error: err instanceof Error ? err.message : "Network error" };
    }
  }

  return { success: false, error: "Max retries reached" };
}

export async function sendTelegramDocument(
  chatId: number,
  buffer: Buffer,
  filename: string,
  caption?: string
): Promise<SendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.startsWith("placeholder")) {
    return { success: false, error: "Bot token not configured" };
  }

  const formData = new FormData();
  formData.append("chat_id", String(chatId));
  formData.append("document", new Blob([new Uint8Array(buffer)]), filename);
  if (caption) formData.append("caption", caption);

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: "POST",
      body: formData,
    });

    if (res.ok) return { success: true };

    const data = await res.json().catch(() => ({}));
    return { success: false, error: `Telegram API ${res.status}: ${data.description || "Unknown"}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Network error" };
  }
}
