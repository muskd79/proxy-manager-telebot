import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { t } from "../messages";
import { getOrCreateUser, logChatMessage } from "../utils";
import { languageKeyboard } from "../keyboard";
import { ChatDirection, MessageType } from "@/types/database";
import type { SupportedLanguage } from "@/types/telegram";

export async function handleLanguage(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const lang = user.language as SupportedLanguage;

  await logChatMessage(
    user.id,
    ctx.message?.message_id ?? null,
    ChatDirection.Incoming,
    "/language",
    MessageType.Command
  );

  const text = t("languageSelect", lang);
  await ctx.reply(text, { reply_markup: languageKeyboard() });
  await logChatMessage(
    user.id,
    null,
    ChatDirection.Outgoing,
    text,
    MessageType.Text
  );
}

export async function handleLanguageSelection(
  ctx: Context,
  newLang: SupportedLanguage
) {
  if (!ctx.from) return;

  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("*")
    .eq("telegram_id", ctx.from.id)
    .single();

  if (!user) return;

  await logChatMessage(
    user.id,
    null,
    ChatDirection.Incoming,
    `lang:${newLang}`,
    MessageType.Callback
  );

  await supabaseAdmin
    .from("tele_users")
    .update({ language: newLang })
    .eq("id", user.id);

  const text = t("languageChanged", newLang);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(text);
  await logChatMessage(
    user.id,
    null,
    ChatDirection.Outgoing,
    text,
    MessageType.Text
  );
}
