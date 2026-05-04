import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Wave 23B-bot UX — DB-persisted conversation state for the Telegram
 * bot. Vercel runs serverless; in-memory Map state evaporates between
 * cold starts. Mirrors VIA's bot_state shape, slimmed for the proxy
 * bot's smaller surface (no categories, no warranty, no UID flow yet).
 *
 * Wave 25-pre4 (Pass: state-machine-union) — `BotState` is now a
 * discriminated union per step. Pre-fix it was a flat interface with
 * every context field optional (`proxyType?`, `quantity?`, `mode?`)
 * and every consumer had to runtime-check that the right combo was
 * present (e.g. `if (state.proxyType && state.quantity && state.mode)`).
 * Now consumers write `if (state.step === "awaiting_confirm")` and
 * TypeScript narrows `state.quantity` to `number` automatically — no
 * runtime check, no optional-soup. Wave 26 states (e.g.
 * `awaiting_payment_proof`, `awaiting_renewal_choice`) become one new
 * union member each; every dispatcher that switches on step gets
 * exhaustiveness-checked by TS.
 *
 * TTL enforced at read time. Future cron can sweep stale rows.
 */

export type BotStep = BotState["step"];

export type OrderModeStored = "quick" | "custom";

/**
 * Discriminated union over `step`. Each member carries exactly the
 * context fields that step needs — no more, no less.
 */
export type BotState =
  | { step: "idle" }
  | { step: "awaiting_quick_qty"; proxyType: string }
  | { step: "awaiting_custom_qty"; proxyType: string }
  | {
      step: "awaiting_confirm";
      proxyType: string;
      quantity: number;
      mode: OrderModeStored;
    }
  | { step: "awaiting_check_list" }
  /**
   * Wave 26-D-2B — warranty reason "other" text input.
   *
   * After user picks proxy + reason_code = "other" from the inline
   * keyboard, bot prompts for a free-text description. Until they
   * reply (or send /cancel), every text message routes to the
   * warranty submit handler.
   *
   * Mirror of the awaiting_custom_qty pattern (custom-order flow).
   */
  | { step: "awaiting_warranty_reason_text"; proxyId: string };

const STATE_TTL_MS = 30 * 60 * 1000; // 30 min

const VALID_STEPS: ReadonlySet<BotStep> = new Set([
  "idle",
  "awaiting_quick_qty",
  "awaiting_custom_qty",
  "awaiting_confirm",
  "awaiting_check_list",
  "awaiting_warranty_reason_text",
]);

/**
 * Build a typed BotState from the raw step + context fields read out
 * of `bot_conversation_state`. Returns `null` when the row is corrupt
 * or required fields are missing for the claimed step (caller
 * recovers by clearing state + falling back to idle).
 */
function reconstructState(
  step: string,
  ctxRaw: Record<string, unknown>,
): BotState | null {
  if (!VALID_STEPS.has(step as BotStep)) return null;

  const proxyType = typeof ctxRaw.proxyType === "string" ? ctxRaw.proxyType : null;
  const quantity =
    typeof ctxRaw.quantity === "number" && Number.isFinite(ctxRaw.quantity)
      ? ctxRaw.quantity
      : null;
  const mode =
    ctxRaw.mode === "quick" || ctxRaw.mode === "custom" ? ctxRaw.mode : null;
  // Wave 26-D-2B — warranty proxy_id field is UUID-shaped string.
  const proxyId = typeof ctxRaw.proxyId === "string" ? ctxRaw.proxyId : null;

  switch (step as BotStep) {
    case "idle":
      return { step: "idle" };
    case "awaiting_quick_qty":
      if (!proxyType) return null;
      return { step: "awaiting_quick_qty", proxyType };
    case "awaiting_custom_qty":
      if (!proxyType) return null;
      return { step: "awaiting_custom_qty", proxyType };
    case "awaiting_confirm":
      if (!proxyType || quantity === null || !mode) return null;
      return { step: "awaiting_confirm", proxyType, quantity, mode };
    case "awaiting_check_list":
      return { step: "awaiting_check_list" };
    case "awaiting_warranty_reason_text":
      if (!proxyId || !/^[0-9a-f-]{36}$/i.test(proxyId)) return null;
      return { step: "awaiting_warranty_reason_text", proxyId };
  }
}

/**
 * Serialize the union back to the flat shape the DB row expects.
 * The `context` JSONB is intentionally permissive — older deploys
 * and the discriminated-union form both round-trip through it.
 */
function serializeContext(state: BotState): Record<string, unknown> {
  switch (state.step) {
    case "idle":
      return { proxyType: null, quantity: null, mode: null };
    case "awaiting_quick_qty":
    case "awaiting_custom_qty":
      return { proxyType: state.proxyType, quantity: null, mode: null };
    case "awaiting_confirm":
      return {
        proxyType: state.proxyType,
        quantity: state.quantity,
        mode: state.mode,
      };
    case "awaiting_check_list":
      return { proxyType: null, quantity: null, mode: null };
    case "awaiting_warranty_reason_text":
      return { proxyId: state.proxyId, proxyType: null, quantity: null, mode: null };
  }
}

/**
 * Wave 27 bug hunt v6 [debugger #5, MEDIUM] — shared TTL-expiry resolver.
 *
 * Pre-fix: getBotState and getBotStateWithExpiry duplicated identical
 * expiry handling, AND swallowed clearBotState errors. If the DELETE
 * failed (transient DB hiccup), the row stayed but the function still
 * returned `{ step: "idle" }` — correct for the user but the next bot
 * message hits the same expired row and tries to clear again. High-
 * frequency users could generate dozens of failed DELETE attempts/sec.
 *
 * Now: extracted helper logs the failure (so ops sees DB hiccups in
 * error tracking) but still returns idle to the caller (the expired
 * state is semantically gone whether or not the DB row got deleted).
 */
async function resolveExpiredState(teleUserId: string): Promise<BotState> {
  try {
    await clearBotState(teleUserId);
  } catch (err) {
    console.error(
      `[bot-state] clearBotState failed during TTL expiry for tele_user_id=${teleUserId}:`,
      err,
    );
  }
  return { step: "idle" };
}

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
      return resolveExpiredState(teleUserId);
    }
  }

  const ctx = (data.context as Record<string, unknown>) || {};
  const state = reconstructState(String(data.step), ctx);
  if (!state) {
    // Unknown step or missing required context (older deploy / corruption).
    return resolveExpiredState(teleUserId);
  }
  return state;
}

/**
 * Wave 25-pre4 (Pass 2.3) — variant that also reports whether the
 * read was a TTL expiry. The caller can use this to send a recovery
 * hint ("Phiên hết hạn — bấm /checkproxy lại") instead of falling
 * through to the generic /help fallback.
 */
export async function getBotStateWithExpiry(
  teleUserId: string,
): Promise<{ state: BotState; expired: boolean }> {
  const { data } = await supabaseAdmin
    .from("bot_conversation_state")
    .select("step, context, updated_at")
    .eq("tele_user_id", teleUserId)
    .maybeSingle();

  if (!data) return { state: { step: "idle" }, expired: false };

  if (data.updated_at) {
    const age = Date.now() - new Date(data.updated_at).getTime();
    if (age > STATE_TTL_MS && data.step !== "idle") {
      const cleared = await resolveExpiredState(teleUserId);
      return { state: cleared, expired: true };
    }
  }

  const ctx = (data.context as Record<string, unknown>) || {};
  const state = reconstructState(String(data.step), ctx);
  if (!state) {
    const cleared = await resolveExpiredState(teleUserId);
    return { state: cleared, expired: false };
  }
  return { state, expired: false };
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
        context: serializeContext(state),
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
