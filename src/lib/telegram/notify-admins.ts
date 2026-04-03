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

  for (const id of filtered) {
    sendTelegramMessage(id, text, options?.inlineKeyboard).catch(console.error);
  }
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
