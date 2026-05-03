/**
 * Wave 25-pre3 (Pass 5.1) — single source of truth for status icon
 * prefixes used in user-visible bot messages.
 *
 * The bot copy uses 5 ASCII prefixes by policy (no playful emoji per
 * the project rule enforced in via-format.test.ts emoji scan):
 *   [X]   error   — failure / blocked / hard rejection
 *   [!]   warn    — rate limit / soft failure / "almost"
 *   [i]   info    — pending / neutral notice / FYI
 *   [OK]  ok      — success / done
 *   [-]   neutral — timed out / unknown / soft-skip
 *
 * Pre-fix these prefixes were hardcoded as raw strings ([X] [!] [i]
 * [OK] [-]) in dozens of places across messages.ts and command files.
 * If we ever want to swap the vocabulary (e.g. drop [X] for ❌ once
 * the no-emoji policy relaxes, or unify [-] with [!] because users
 * confuse them) we'd have to grep + edit every site. Now: change
 * one constant.
 *
 * Admin-side status badges (e.g. "[Approved]", "[Rejected]") are
 * NOT covered here — those are admin-internal and have their own
 * vocabulary. Keep them inline.
 *
 * Usage:
 *   import { Icon } from "@/lib/telegram/icons";
 *   `${Icon.error} Yêu cầu proxy đã bị từ chối.`
 */
export const Icon = {
  /** [X] — failure / blocked / hard rejection. Use sparingly. */
  error: "[X]",
  /** [!] — rate limit / soft failure / warning. */
  warn: "[!]",
  /** [i] — pending / neutral notice / informational. */
  info: "[i]",
  /** [OK] — success / done / assigned. */
  ok: "[OK]",
  /** [-] — timed out / unknown / soft-skip. Distinct from error. */
  neutral: "[-]",
} as const;

export type IconKey = keyof typeof Icon;
