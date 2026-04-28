import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ChatDirection, MessageType } from "@/types/database";
import type { ChatMessageInsert, ActivityLogInsert } from "@/types/database";

/**
 * Telegram bot side-effect logging.
 *
 * Two append-only tables:
 *   - chat_messages: every inbound/outbound user message (for support replay)
 *   - activity_logs: every state-changing bot action (for audit + incident response)
 *
 * Wave 22E-4 split: extracted from src/lib/telegram/utils.ts.
 * The original utils.ts grew to 290 lines mixing 4 concerns. This file
 * owns ONLY the two append-log helpers — no auth, no rate-limit, no RPCs.
 *
 * Both helpers fire-and-forget by design: a missed log row must not break
 * the user's request flow. Callers should NOT await the result expecting
 * write confirmation; the supabaseAdmin client retries on transport errors.
 */

export async function logChatMessage(
  teleUserId: string,
  messageId: number | null,
  direction: ChatDirection,
  text: string | null,
  messageType: MessageType,
  rawData?: Record<string, unknown> | null,
): Promise<void> {
  const insert: ChatMessageInsert = {
    tele_user_id: teleUserId,
    telegram_message_id: messageId,
    direction,
    message_text: text,
    message_type: messageType,
    raw_data: rawData ?? null,
  };
  await supabaseAdmin.from("chat_messages").insert(insert);
}

export async function logActivity(log: ActivityLogInsert): Promise<void> {
  await supabaseAdmin.from("activity_logs").insert(log);
}
