import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { t } from "../messages";
import { getOrCreateUser, getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
import { languageKeyboard } from "../keyboard";
import { clearBotState, getBotState } from "../state";
import { restartFlowKeyboard } from "../recovery-keyboard";
import { ChatDirection, MessageType } from "@/types/database";
import type { SupportedLanguage } from "@/types/telegram";

export async function handleLanguage(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const lang = getUserLanguage(user);

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

  // Wave 25-pre2 (Pass 3.5) — clear any non-idle conversation state
  // when language switches. Pre-fix a user mid-`awaiting_quick_qty`
  // who flipped lang would still see their old prompt in the OLD
  // language, then their next text input got consumed silently by
  // the qty handler. Now we drop the state + tell them to start
  // over so the next prompt comes in the NEW language.
  const state = await getBotState(user.id);
  const wasMidFlow = state.step !== "idle";
  if (wasMidFlow) {
    await clearBotState(user.id);
  }

  const text = t("languageChanged", newLang);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(text);

  if (wasMidFlow) {
    // Wave 25-pre3 (Pass 2.B) — append a restart button so the user
    // doesn't need to remember the slash command.
    const restartText = newLang === "vi"
      ? "Phiên trước đã được huỷ do đổi ngôn ngữ. Bấm bên dưới để bắt đầu lại."
      : "Previous session cleared due to language change. Tap below to start over.";
    await ctx.reply(restartText, {
      reply_markup: restartFlowKeyboard(newLang, "request"),
    });
    await logChatMessage(
      user.id,
      null,
      ChatDirection.Outgoing,
      restartText,
      MessageType.Text,
    );
  }

  await logChatMessage(
    user.id,
    null,
    ChatDirection.Outgoing,
    text,
    MessageType.Text
  );
}
