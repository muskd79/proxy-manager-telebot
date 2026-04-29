import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Wave 23B-bot UX — DB-persisted conversation state for the Telegram
 * bot. Vercel runs serverless; in-memory Map state evaporates between
 * cold starts. Mirrors VIA's bot_state shape, slimmed for the proxy
 * bot's smaller surface (no categories, no warranty, no UID flow yet).
 *
 * Steps:
 *   - 'idle' (default — no value needed)
 *   - 'awaiting_quick_qty'   — Order nhanh, expecting a number 1..maxQuick
 *   - 'awaiting_custom_qty'  — Order riêng, expecting a number ≥1
 *
 * TTL enforced at read time. Future cron can sweep stale rows.
 */

export type BotStep =
  | "idle"
  | "awaiting_quick_qty"
  | "awaiting_custom_qty";

export interface BotState {
  step: BotStep;
  /** Proxy type the user picked before entering qty (http/https/socks5). */
  proxyType?: string;
}

const STATE_TTL_MS = 30 * 60 * 1000; // 30 min

const VALID_STEPS: BotStep[] = [
  "idle",
  "awaiting_quick_qty",
  "awaiting_custom_qty",
];

export async function getBotState(teleUserId: string): Promise<BotState> {
  const { data } = await supabaseAdmin
    .from("bot_conversation_state")
    .select("step, context, updated_at")
    .eq("tele_user_id", teleUserId)
    .maybeSingle();

  if (!data) return { step: "idle" };

  if (data.updated_at) {
    const age = Date.now() - new Date(data.updated_at).getTime();
    if (age > STATE_TTL_MS && data.step !== "idle") {
      await clearBotState(teleUserId);
      return { step: "idle" };
    }
  }

  if (!VALID_STEPS.includes(data.step as BotStep)) {
    // Unknown step (older deploy or corruption) — recover.
    await clearBotState(teleUserId);
    return { step: "idle" };
  }

  const ctx = (data.context as Record<string, unknown>) || {};
  return {
    step: data.step as BotStep,
    proxyType: typeof ctx.proxyType === "string" ? ctx.proxyType : undefined,
  };
}

export async function setBotState(
  teleUserId: string,
  state: BotState,
): Promise<void> {
  await supabaseAdmin
    .from("bot_conversation_state")
    .upsert(
      {
        tele_user_id: teleUserId,
        step: state.step,
        context: { proxyType: state.proxyType ?? null },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tele_user_id" },
    );
}

export async function clearBotState(teleUserId: string): Promise<void> {
  await supabaseAdmin
    .from("bot_conversation_state")
    .delete()
    .eq("tele_user_id", teleUserId);
}
