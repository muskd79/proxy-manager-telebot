const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // exponential backoff

interface SendResult {
  success: boolean;
  error?: string;
}

export async function sendTelegramMessage(
  chatId: number,
  text: string,
  options?: { parse_mode?: string }
): Promise<SendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.startsWith("placeholder")) {
    return { success: false, error: "Bot token not configured" };
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: options?.parse_mode || "Markdown",
        }),
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
