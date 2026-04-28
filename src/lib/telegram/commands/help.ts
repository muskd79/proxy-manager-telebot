import type { Context } from "grammy";
import { t } from "../messages";
import { getOrCreateUser, getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
import { ChatDirection, MessageType } from "@/types/database";

export async function handleHelp(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  if (!user) return;
  const lang = getUserLanguage(user);

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

  const lang = getUserLanguage(user);

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
