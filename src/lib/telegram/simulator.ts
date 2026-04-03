import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";

interface SimulatorOptions {
  command?: string;
  callbackData?: string;
  text?: string;
}

/**
 * Create a mock Grammy Context for the bot simulator.
 * All reply methods write to chat_messages DB table instead of calling Telegram API.
 */
export function createSimulatorContext(
  user: {
    id: string;
    telegram_id: number;
    username: string | null;
    first_name: string | null;
    language: string;
  },
  options: SimulatorOptions
): Context {
  const chatId = user.telegram_id;

  const ctx = {
    from: {
      id: chatId,
      is_bot: false,
      first_name: user.first_name || "Test",
      username: user.username || undefined,
      language_code: user.language === "vi" ? "vi" : "en",
    },
    chat: {
      id: chatId,
      type: "private" as const,
      first_name: user.first_name || "Test",
    },
    message: options.command
      ? {
          message_id: Date.now(),
          from: {
            id: chatId,
            is_bot: false,
            first_name: user.first_name || "Test",
            username: user.username,
          },
          chat: { id: chatId, type: "private" as const },
          date: Math.floor(Date.now() / 1000),
          text: options.command.startsWith("/")
            ? options.command
            : `/${options.command}`,
          entities: [
            {
              offset: 0,
              length:
                options.command.length +
                (options.command.startsWith("/") ? 0 : 1),
              type: "bot_command" as const,
            },
          ],
        }
      : undefined,
    callbackQuery: options.callbackData
      ? {
          id: String(Date.now()),
          from: {
            id: chatId,
            is_bot: false,
            first_name: user.first_name || "Test",
            username: user.username,
          },
          message: {
            message_id: Date.now() - 1,
            from: { id: 0, is_bot: true, first_name: "Bot" },
            chat: { id: chatId, type: "private" as const },
            date: Math.floor(Date.now() / 1000),
            text: "Previous message",
          },
          chat_instance: "simulator",
          data: options.callbackData,
        }
      : undefined,

    reply: async (text: string, replyOptions?: Record<string, unknown>) => {
      const keyboard = replyOptions?.reply_markup;
      await supabaseAdmin.from("chat_messages").insert({
        tele_user_id: user.id,
        telegram_message_id: null,
        direction: "outgoing",
        message_text: text,
        message_type: "text",
        raw_data: keyboard ? { reply_markup: serializeKeyboard(keyboard) } : null,
      });
      return { message_id: Date.now() };
    },

    editMessageText: async (
      text: string,
      editOptions?: Record<string, unknown>
    ) => {
      const keyboard = editOptions?.reply_markup;
      await supabaseAdmin.from("chat_messages").insert({
        tele_user_id: user.id,
        telegram_message_id: null,
        direction: "outgoing",
        message_text: text,
        message_type: "text",
        raw_data: keyboard ? { reply_markup: serializeKeyboard(keyboard) } : null,
      });
    },

    answerCallbackQuery: async (text?: string) => {
      if (text) {
        await supabaseAdmin.from("chat_messages").insert({
          tele_user_id: user.id,
          telegram_message_id: null,
          direction: "outgoing",
          message_text: `[Callback] ${text}`,
          message_type: "system",
        });
      }
    },

    // Grammy match property (used by some handlers for callback data)
    match: options.callbackData || "",
  } as unknown as Context;

  return ctx;
}

function serializeKeyboard(keyboard: unknown): Record<string, unknown> | null {
  if (!keyboard || typeof keyboard !== "object") return null;

  const kb = keyboard as Record<string, unknown>;

  // Grammy InlineKeyboard stores data in inline_keyboard
  if (kb.inline_keyboard) {
    return { inline_keyboard: kb.inline_keyboard };
  }

  // Grammy Keyboard stores data in keyboard
  if (kb.keyboard) {
    return { keyboard: kb.keyboard };
  }

  // Try raw serialization as fallback
  try {
    return JSON.parse(JSON.stringify(keyboard));
  } catch {
    return null;
  }
}
