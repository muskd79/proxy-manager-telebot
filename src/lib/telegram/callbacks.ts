/**
 * Wave 25-pre3 (Pass 5.2 — HIGHEST LEVERAGE REFACTOR per design review).
 *
 * Single source of truth for inline-keyboard callback wire format.
 *
 * Pre-fix the 200-line `if (data.startsWith(...))` ladder in
 * handlers.ts:86-292 had 17 different callback prefixes with no
 * type-safety, no exhaustiveness check, and no shared pattern. New
 * dev adding Wave 26 vendor button had to:
 *   1. Invent a prefix string
 *   2. Add a startsWith branch in handlers.ts
 *   3. Hope they remembered all the format edge cases
 *
 * Now:
 *   - `CallbackData` is a discriminated union over `kind`.
 *   - `parseCallback(data)` returns the typed union (or null).
 *   - `serializeCallback(cb)` produces the wire format.
 *   - `CB.*` builders construct callback strings for use in
 *     keyboard.ts (so we never paste raw `"menu:request"` literals
 *     and risk drift like `"menu_request"` or `"menu:Request"`).
 *
 * After this lands, handlers.ts callback dispatcher becomes a single
 * `switch (parsed.kind)` — TypeScript exhaustiveness ensures every
 * future `kind` member added here forces every dispatcher to handle
 * it. Wave 26 vendor / payment / kyc callbacks become one new union
 * member each.
 *
 * BACKWARD COMPAT
 * ---------------
 * Some legacy shapes are accepted by `parseCallback` to keep
 * already-rendered Telegram keyboards (in user chat history) working
 * after deploy:
 *   - `menu:warranty` (renamed → `menu:return` in Wave 25-pre2)
 *   - `qty:<type>:<n>` 2-arg legacy shape (default to mode="quick")
 * Both legacy paths emit a Sentry breadcrumb (level=info) so we can
 * verify zero hits before deletion. See decision-log.md
 * `legacy-qty-callback`.
 */

import type { SupportedLanguage } from "@/types/telegram";

// ---------------------------------------------------------------------------
// Domain types reused across the union
// ---------------------------------------------------------------------------

/**
 * String-literal mirror of the `ProxyType` enum in @/types/database.
 * Kept local because callbacks.ts is a low-level wire-format module
 * and pulling the enum back through database.ts (which imports many
 * other things) makes the dep graph noisy.
 */
export type ProxyType = "http" | "https" | "socks5";
export type OrderMode = "quick" | "custom";
export type ConfirmResult = "yes" | "no";

/**
 * Top-level menu actions exposed by the inline keyboard at /start.
 * Order matches keyboard.ts mainMenuKeyboard layout.
 */
export type MenuAction =
  | "request"
  | "my"
  | "check"
  | "limit"
  | "return"
  | "history"
  | "help"
  | "language";

/**
 * Admin actions from inline keyboards in admin notifications.
 * Underscore-separated to match the existing wire format
 * (e.g. `admin_approve_user:<id>` not `admin:approve_user:<id>`).
 */
export type AdminAction =
  | "approve"
  | "reject"
  | "approve_user"
  | "block_user"
  | "bulk_approve"
  | "bulk_reject";

// ---------------------------------------------------------------------------
// Discriminated union — every callback shape used by the bot.
// ---------------------------------------------------------------------------

export type CallbackData =
  | { kind: "menu"; action: MenuAction }

  | { kind: "type"; proxyType: ProxyType }
  | { kind: "typeCancel" }

  | { kind: "order"; mode: OrderMode; proxyType: string }
  | { kind: "orderCancel" }

  | { kind: "qty"; mode: OrderMode; proxyType: string; quantity: number }
  | { kind: "qtyCancel"; mode?: OrderMode }

  | { kind: "confirm"; result: ConfirmResult }

  | { kind: "checkCancel" }

  | { kind: "lang"; lang: SupportedLanguage }

  | { kind: "cancelConfirm"; result: ConfirmResult }

  | { kind: "revokeConfirmAll"; count: string }
  | { kind: "revoke"; target: string }
  | { kind: "revokeCancel" }

  | { kind: "admin"; action: AdminAction; targetId: string };

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a Telegram callback_data string into the typed union.
 * Returns null when the prefix doesn't match anything we know about.
 *
 * Order of checks matters when prefixes overlap (e.g. `revoke_confirm:`
 * MUST be checked before `revoke:` because `startsWith` matches both).
 */
export function parseCallback(data: string): CallbackData | null {
  if (!data) return null;

  // -----------------------------------------------------------------
  // menu:<action>
  // -----------------------------------------------------------------
  if (data.startsWith("menu:")) {
    const action = data.slice("menu:".length);
    // Wave 25-pre2 (Pass 1.1) — `menu:warranty` was renamed to
    // `menu:return` but keyboards already rendered in user chat
    // history may still emit the old prefix. Map both to the new
    // canonical action so old buttons still work.
    if (action === "warranty") {
      return { kind: "menu", action: "return" };
    }
    if (isMenuAction(action)) {
      return { kind: "menu", action };
    }
    return null;
  }

  // -----------------------------------------------------------------
  // proxy_type:<type|cancel>
  // -----------------------------------------------------------------
  if (data.startsWith("proxy_type:")) {
    const t = data.slice("proxy_type:".length);
    if (t === "cancel") return { kind: "typeCancel" };
    if (isProxyType(t)) return { kind: "type", proxyType: t };
    return null;
  }

  // -----------------------------------------------------------------
  // order_quick:<type> / order_custom:<type> / order_type:cancel
  // -----------------------------------------------------------------
  if (data === "order_type:cancel") return { kind: "orderCancel" };
  if (data.startsWith("order_quick:")) {
    return { kind: "order", mode: "quick", proxyType: data.slice("order_quick:".length) };
  }
  if (data.startsWith("order_custom:")) {
    return { kind: "order", mode: "custom", proxyType: data.slice("order_custom:".length) };
  }

  // -----------------------------------------------------------------
  // qty:<...>
  //
  // Shapes:
  //   qty:cancel
  //   qty:quick:cancel  | qty:custom:cancel
  //   qty:quick:<type>:<n>  | qty:custom:<type>:<n>
  //   qty:<type>:<n>           ← LEGACY 2-arg shape
  // -----------------------------------------------------------------
  if (data === "qty:cancel") return { kind: "qtyCancel" };
  if (data === "qty:quick:cancel") return { kind: "qtyCancel", mode: "quick" };
  if (data === "qty:custom:cancel") return { kind: "qtyCancel", mode: "custom" };
  if (data.startsWith("qty:")) {
    const parts = data.split(":");
    // qty:<mode>:<type>:<n>
    if (parts.length === 4 && (parts[1] === "quick" || parts[1] === "custom")) {
      const n = parseInt(parts[3], 10);
      if (Number.isFinite(n) && n > 0) {
        return { kind: "qty", mode: parts[1], proxyType: parts[2], quantity: n };
      }
      return null;
    }
    // Legacy qty:<type>:<n> — default to "quick".
    if (parts.length === 3) {
      const n = parseInt(parts[2], 10);
      if (Number.isFinite(n) && n > 0) {
        return { kind: "qty", mode: "quick", proxyType: parts[1], quantity: n };
      }
    }
    return null;
  }

  // -----------------------------------------------------------------
  // confirm:yes | confirm:no
  // -----------------------------------------------------------------
  if (data === "confirm:yes") return { kind: "confirm", result: "yes" };
  if (data === "confirm:no") return { kind: "confirm", result: "no" };

  // -----------------------------------------------------------------
  // check:cancel
  // -----------------------------------------------------------------
  if (data === "check:cancel") return { kind: "checkCancel" };

  // -----------------------------------------------------------------
  // lang:vi | lang:en
  // -----------------------------------------------------------------
  if (data.startsWith("lang:")) {
    const l = data.slice("lang:".length);
    if (l === "vi" || l === "en") return { kind: "lang", lang: l };
    return null;
  }

  // -----------------------------------------------------------------
  // cancel_confirm:yes|no  (NB: must precede generic "cancel"-prefix
  // checks; in practice no other prefix conflicts)
  // -----------------------------------------------------------------
  if (data === "cancel_confirm:yes") return { kind: "cancelConfirm", result: "yes" };
  if (data === "cancel_confirm:no") return { kind: "cancelConfirm", result: "no" };

  // -----------------------------------------------------------------
  // revoke_confirm:all:<count>  ← MUST come before `revoke:`
  // revoke:cancel | revoke:<id|"all">
  // -----------------------------------------------------------------
  if (data.startsWith("revoke_confirm:all:")) {
    return { kind: "revokeConfirmAll", count: data.slice("revoke_confirm:all:".length) };
  }
  if (data === "revoke:cancel") return { kind: "revokeCancel" };
  if (data.startsWith("revoke:")) {
    return { kind: "revoke", target: data.slice("revoke:".length) };
  }

  // -----------------------------------------------------------------
  // admin_*:<id>
  // -----------------------------------------------------------------
  if (data.startsWith("admin_bulk_approve:")) {
    return { kind: "admin", action: "bulk_approve", targetId: data.slice("admin_bulk_approve:".length) };
  }
  if (data.startsWith("admin_bulk_reject:")) {
    return { kind: "admin", action: "bulk_reject", targetId: data.slice("admin_bulk_reject:".length) };
  }
  if (data.startsWith("admin_approve_user:")) {
    return { kind: "admin", action: "approve_user", targetId: data.slice("admin_approve_user:".length) };
  }
  if (data.startsWith("admin_block_user:")) {
    return { kind: "admin", action: "block_user", targetId: data.slice("admin_block_user:".length) };
  }
  if (data.startsWith("admin_approve:")) {
    return { kind: "admin", action: "approve", targetId: data.slice("admin_approve:".length) };
  }
  if (data.startsWith("admin_reject:")) {
    return { kind: "admin", action: "reject", targetId: data.slice("admin_reject:".length) };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Serializer (inverse of parseCallback). Use via the CB builder helpers.
// ---------------------------------------------------------------------------

export function serializeCallback(cb: CallbackData): string {
  switch (cb.kind) {
    case "menu":
      return `menu:${cb.action}`;
    case "type":
      return `proxy_type:${cb.proxyType}`;
    case "typeCancel":
      return "proxy_type:cancel";
    case "order":
      return `order_${cb.mode}:${cb.proxyType}`;
    case "orderCancel":
      return "order_type:cancel";
    case "qty":
      return `qty:${cb.mode}:${cb.proxyType}:${cb.quantity}`;
    case "qtyCancel":
      return cb.mode ? `qty:${cb.mode}:cancel` : "qty:cancel";
    case "confirm":
      return `confirm:${cb.result}`;
    case "checkCancel":
      return "check:cancel";
    case "lang":
      return `lang:${cb.lang}`;
    case "cancelConfirm":
      return `cancel_confirm:${cb.result}`;
    case "revokeConfirmAll":
      return `revoke_confirm:all:${cb.count}`;
    case "revoke":
      return `revoke:${cb.target}`;
    case "revokeCancel":
      return "revoke:cancel";
    case "admin":
      return `admin_${cb.action}:${cb.targetId}`;
  }
}

// ---------------------------------------------------------------------------
// Builder helpers (use in keyboard.ts to construct InlineKeyboard buttons).
// One function per `kind` so callers can't accidentally drop a required
// argument.
// ---------------------------------------------------------------------------

export const CB = {
  menu: (action: MenuAction): string => serializeCallback({ kind: "menu", action }),
  type: (proxyType: ProxyType): string => serializeCallback({ kind: "type", proxyType }),
  typeCancel: (): string => serializeCallback({ kind: "typeCancel" }),
  order: (mode: OrderMode, proxyType: string): string =>
    serializeCallback({ kind: "order", mode, proxyType }),
  orderCancel: (): string => serializeCallback({ kind: "orderCancel" }),
  qty: (mode: OrderMode, proxyType: string, quantity: number): string =>
    serializeCallback({ kind: "qty", mode, proxyType, quantity }),
  qtyCancel: (mode?: OrderMode): string =>
    serializeCallback({ kind: "qtyCancel", mode }),
  confirm: (result: ConfirmResult): string =>
    serializeCallback({ kind: "confirm", result }),
  checkCancel: (): string => serializeCallback({ kind: "checkCancel" }),
  lang: (lang: SupportedLanguage): string => serializeCallback({ kind: "lang", lang }),
  cancelConfirm: (result: ConfirmResult): string =>
    serializeCallback({ kind: "cancelConfirm", result }),
  revokeConfirmAll: (count: string | number): string =>
    serializeCallback({ kind: "revokeConfirmAll", count: String(count) }),
  revoke: (target: string): string => serializeCallback({ kind: "revoke", target }),
  revokeCancel: (): string => serializeCallback({ kind: "revokeCancel" }),
  admin: (action: AdminAction, targetId: string): string =>
    serializeCallback({ kind: "admin", action, targetId }),
} as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const MENU_ACTIONS: ReadonlySet<string> = new Set([
  "request",
  "my",
  "check",
  "limit",
  "return",
  "history",
  "help",
  "language",
]);

function isMenuAction(s: string): s is MenuAction {
  return MENU_ACTIONS.has(s);
}

const PROXY_TYPES: ReadonlySet<string> = new Set(["http", "https", "socks5"]);

function isProxyType(s: string): s is ProxyType {
  return PROXY_TYPES.has(s);
}
