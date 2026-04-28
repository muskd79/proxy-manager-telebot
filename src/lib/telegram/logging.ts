import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ChatDirection, MessageType } from "@/types/database";
import type { ChatMessageInsert, ActivityLogInsert } from "@/types/database";
import { logActivity as coreLogActivity } from "@/lib/logger";

/**
 * Telegram bot side-effect logging.
 *
 * Two append-only tables:
 *   - chat_messages: every inbound/outbound user message (for support replay)
 *   - activity_logs: every state-changing bot action (for audit + incident response)
 *
 * Wave 22E-4 split: extracted from src/lib/telegram/utils.ts.
 *
 * Wave 22D security fix (security-reviewer Q1, HIGH severity):
 * `logActivity` here previously did a raw `supabaseAdmin.from("activity_logs").insert(log)`
 * with no sanitisation and no per-string length cap. A Telegram username
 * like `"\nERROR actor_type=admin action=delete_all"` could forge a second
 * structured row in any line-oriented log scraper, and a megabyte-scale
 * blob in `details` would land in the DB unbounded. Both were exploitable
 * by any Telegram user.
 *
 * The fix: `logActivity` now adapts the snake_case `ActivityLogInsert`
 * shape to the canonical `lib/logger.ts:logActivity` (camelCase, sanitised,
 * 1024-char-per-string cap). All 14 telegram command files keep their
 * existing `import { logActivity } from "../logging"` — no caller churn.
 *
 * `logChatMessage` does not need sanitisation: `chat_messages.message_text`
 * stores user content by design (it IS the chat history). Forging an
 * extra row there forges nothing — every row is already user-supplied.
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

/**
 * Telegram-side audit log writer. Adapts the snake_case insert shape
 * to lib/logger.ts so all activity_logs writes share the same
 * sanitisation pipeline. See file-level docblock for the security
 * reasoning behind this delegation.
 */
export async function logActivity(log: ActivityLogInsert): Promise<void> {
  await coreLogActivity({
    actorType: log.actor_type,
    actorId: log.actor_id ?? undefined,
    action: log.action,
    resourceType: log.resource_type ?? undefined,
    resourceId: log.resource_id ?? undefined,
    details:
      (log.details as Record<string, unknown> | null | undefined) ?? undefined,
    ipAddress: log.ip_address ?? undefined,
    userAgent: log.user_agent ?? undefined,
  });
}
