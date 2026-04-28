import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "./send";
import { InlineKeyboard } from "grammy";

/**
 * Get all admin Telegram IDs from:
 * 1. admins table (primary - per-admin telegram_id)
 * 2. settings.admin_telegram_ids (fallback for backward compat)
 * Returns deduplicated array of Telegram IDs.
 */
export async function getAdminTelegramIds(): Promise<number[]> {
  const ids = new Set<number>();

  // Primary: admins table
  const { data: admins } = await supabaseAdmin
    .from("admins")
    .select("telegram_id")
    .not("telegram_id", "is", null)
    .eq("is_active", true);

  if (admins) {
    for (const a of admins) {
      if (a.telegram_id) ids.add(a.telegram_id);
    }
  }

  // Fallback: settings table
  const { data: setting } = await supabaseAdmin
    .from("settings")
    .select("value")
    .eq("key", "admin_telegram_ids")
    .single();

  if (setting?.value?.value && Array.isArray(setting.value.value)) {
    for (const id of setting.value.value) {
      if (typeof id === "number") ids.add(id);
    }
  }

  return Array.from(ids);
}

/**
 * Get admin display label (full_name or email) by admin ID.
 */
export async function getAdminLabel(adminId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("admins")
    .select("full_name, email")
    .eq("id", adminId)
    .single();
  return data?.full_name || data?.email || "Admin";
}

/**
 * Get admin info by their Telegram ID.
 * Returns { isAdmin: true, adminId, label } or { isAdmin: false }.
 */
export async function getAdminByTelegramId(telegramId: number): Promise<{
  isAdmin: boolean;
  adminId?: string;
  label?: string;
}> {
  // Check admins table first
  const { data: admin } = await supabaseAdmin
    .from("admins")
    .select("id, full_name, email")
    .eq("telegram_id", telegramId)
    .eq("is_active", true)
    .single();

  if (admin) {
    return { isAdmin: true, adminId: admin.id, label: admin.full_name || admin.email };
  }

  // Fallback: check settings
  const { data: setting } = await supabaseAdmin
    .from("settings")
    .select("value")
    .eq("key", "admin_telegram_ids")
    .single();

  if (setting?.value?.value && Array.isArray(setting.value.value)) {
    if (setting.value.value.includes(telegramId)) {
      return { isAdmin: true, label: `Admin (${telegramId})` };
    }
  }

  return { isAdmin: false };
}

/**
 * Notify ALL admins with Telegram IDs.
 *
 * Wave 22D-4 reliability fix:
 *   Pre-22D-4 fired each `sendTelegramMessage` in a for-loop with
 *   fire-and-forget `.catch(console.error)`. If Telegram returned
 *   429 (rate limit) on the 2nd admin, ALL subsequent admins
 *   silently missed the notification — the approval-flow ping
 *   would never reach them.
 *   Now: Promise.allSettled + structured failure logging. The
 *   function still returns void (caller doesn't need success
 *   info), but failures land in logs with the offending Telegram
 *   ID + reason, surfacing the reliability hole at incident time.
 */
export async function notifyAllAdmins(
  text: string,
  options?: {
    excludeTelegramId?: number;
    inlineKeyboard?: InlineKeyboard;
  }
): Promise<void> {
  const ids = await getAdminTelegramIds();
  const filtered = options?.excludeTelegramId
    ? ids.filter(id => id !== options.excludeTelegramId)
    : ids;

  if (filtered.length === 0) return;

  const results = await Promise.allSettled(
    filtered.map((id) =>
      sendTelegramMessage(id, text, options?.inlineKeyboard),
    ),
  );

  // Surface failures with the Telegram ID — without this, a 429 on
  // admin #2 would silently drop notifications for admins #3..#N.
  results.forEach((r, i) => {
    const id = filtered[i];
    if (r.status === "rejected") {
      console.error(
        `[notifyAllAdmins] Failed to notify telegram_id=${id}:`,
        r.reason,
      );
    } else if (r.value && typeof r.value === "object" && "success" in r.value && r.value.success === false) {
      console.error(
        `[notifyAllAdmins] sendTelegramMessage rejected telegram_id=${id}:`,
        (r.value as { error?: string }).error,
      );
    }
  });
}

/**
 * Notify all admins EXCEPT the one who performed the action.
 */
export async function notifyOtherAdmins(
  actorTelegramId: number | null,
  text: string
): Promise<void> {
  await notifyAllAdmins(text, {
    excludeTelegramId: actorTelegramId ?? undefined,
  });
}
