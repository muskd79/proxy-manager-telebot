import type { Context } from "grammy";
import { TeleUserStatus, ChatDirection, MessageType } from "@/types/database";
import type { SupportedLanguage } from "@/types/telegram";
import { t } from "./messages";
import { logChatMessage } from "./logging";

/**
 * Wave 23B-bot-fix — single source of truth for the "is this user
 * allowed to use a proxy command right now?" question.
 *
 * Returns true when the caller should bail out (a reply has already
 * been sent). Returns false when the user is OK and the caller can
 * proceed with the command logic.
 *
 * Pre-fix every command repeated `if (status === 'blocked' || ===
 * 'banned')` and silently allowed PENDING users through, so anyone
 * who /start'ed could request proxies before admin review.
 */
export interface GuardableUser {
  id: string;
  status: TeleUserStatus | string | null;
}

export async function denyIfNotApproved(
  ctx: Context,
  user: GuardableUser,
  lang: SupportedLanguage,
): Promise<boolean> {
  const s = user.status;
  if (s === TeleUserStatus.Blocked || s === TeleUserStatus.Banned) {
    const text = t("accountBlocked", lang);
    await ctx.reply(text);
    await logChatMessage(
      user.id,
      null,
      ChatDirection.Outgoing,
      text,
      MessageType.Text,
    );
    return true;
  }
  if (s === TeleUserStatus.Pending) {
    const text = t("accountPendingApproval", lang);
    await ctx.reply(text);
    await logChatMessage(
      user.id,
      null,
      ChatDirection.Outgoing,
      text,
      MessageType.Text,
    );
    return true;
  }
  return false;
}
