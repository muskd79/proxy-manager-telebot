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

      // Wave 27 bug hunt v7 [debugger #1, HIGH] — explicit AbortSignal
      // timeout. Pre-fix: Node's undici fetch has no default timeout;
      // a stalled `api.telegram.org` (BGP outage, partial TCP hang)
      // would never reject the await, and the cron just sat there
      // until Vercel killed the function at 10s — the remaining
      // notifications in that batch were silently dropped (state
      // already committed to DB). 8s ceiling sits below Vercel's 10s
      // function limit so we always get a clean rejection + can
      // continue the batch.
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj),
        signal: AbortSignal.timeout(8_000),
      });

      if (res.ok) return { success: true };

      const data = await res.json().catch(() => ({}));

      // Don't retry on permanent errors
      if (res.status === 400 || res.status === 403 || res.status === 404) {
        return { success: false, error: `Telegram API ${res.status}: ${data.description || "Unknown"}` };
      }

      // Retry on temporary errors (429, 500, 502, 503).
      //
      // Wave 26-D bug hunt v5 [debugger #3, HIGH] — honor Telegram's
      // Retry-After header on 429. Pre-fix used the fixed
      // RETRY_DELAYS array regardless; Telegram rate-limit retries
      // could stall the cron fan-out for up to 7s/message and
      // chain into Vercel function timeouts.
      // Telegram's Retry-After is in seconds. Cap at 30s so a misbehaving
      // header value (or an unusually long backoff) doesn't pin the
      // cron worker.
      if (attempt < MAX_RETRIES - 1) {
        let delayMs = RETRY_DELAYS[attempt];
        if (res.status === 429) {
          const retryAfterRaw =
            res.headers.get("retry-after") ??
            (data as { parameters?: { retry_after?: number } }).parameters
              ?.retry_after;
          const retryAfterSec =
            typeof retryAfterRaw === "string"
              ? parseInt(retryAfterRaw, 10)
              : typeof retryAfterRaw === "number"
                ? retryAfterRaw
                : NaN;
          if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
            delayMs = Math.min(retryAfterSec * 1000, 30_000);
          }
        }
        await new Promise(r => setTimeout(r, delayMs));
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
    // Wave 27 bug hunt v7 — same explicit timeout as sendTelegramMessage.
    // Bigger ceiling (15s) because document upload is slower; still
    // under Vercel's 10s default but ok for Pro plans (60s) where
    // document delivery typically runs.
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) return { success: true };

    const data = await res.json().catch(() => ({}));
    return { success: false, error: `Telegram API ${res.status}: ${data.description || "Unknown"}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Network error" };
  }
}
