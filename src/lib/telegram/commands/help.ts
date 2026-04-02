import type { Context } from "grammy";
import { t } from "../messages";
import { getOrCreateUser, getUserLang, logChatMessage } from "../utils";
import { ChatDirection, MessageType } from "@/types/database";
import type { SupportedLanguage } from "@/types/telegram";

export async function handleHelp(ctx: Context) {
  const lang = await getUserLang(ctx.from?.id ?? 0);
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  await logChatMessage(
    user.id,
    ctx.message?.message_id ?? null,
    ChatDirection.Incoming,
    "/help",
    MessageType.Command
  );

  const text = t("help", lang);
  await ctx.reply(text, { parse_mode: "Markdown" });

  await logChatMessage(
    user.id,
    null,
    ChatDirection.Outgoing,
    text,
    MessageType.Text
  );
}

export async function handleUnknownCommand(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const lang = user.language as SupportedLanguage;

  await logChatMessage(
    user.id,
    ctx.message?.message_id ?? null,
    ChatDirection.Incoming,
    ctx.message?.text ?? null,
    MessageType.Command
  );

  const text = t("unknownCommand", lang);
  await ctx.reply(text);
  await logChatMessage(
    user.id,
    null,
    ChatDirection.Outgoing,
    text,
    MessageType.Text
  );
}
