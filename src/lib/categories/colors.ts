/**
 * Wave 27 — color tokens for the categories dashboard.
 *
 * Centralised so a future theme change is a one-file diff. Re-uses
 * the project's existing `proxy-labels.ts STATUS_BADGE` palette
 * where possible — keep visual consistency across `/proxies` table
 * and `/categories` cards.
 *
 * No I/O. Pure data + helper functions.
 */

import type { CategoryDashboardRow } from "./types";

/**
 * Tailwind color tokens used by card sub-components. Each entry maps
 * to the project's slate-based dark palette + tinted brand colors.
 *
 * Keep tokens here ONLY if they're referenced in 2+ files. One-off
 * classes belong inline.
 */
export const CARD_COLORS = {
  // Outer card surface
  cardBorder: "border-slate-800/60",
  cardBorderHover: "hover:border-slate-700",
  cardBg: "bg-slate-900/40",
  cardBgHover: "hover:bg-slate-900/70",
  cardBgSelected: "bg-slate-900/70",
  cardBorderSelected: "border-orange-500/60",

  // Visibility chip
  visibleChipBg: "bg-emerald-500/10",
  visibleChipText: "text-emerald-300",
  visibleChipRing: "ring-emerald-500/20",
  visibleChipDot: "bg-emerald-400",
  hiddenChipBg: "bg-slate-500/10",
  hiddenChipText: "text-slate-400",
  hiddenChipRing: "ring-slate-500/20",
  hiddenChipDot: "bg-slate-500",

  // Progress bar segments
  progressTrack: "bg-slate-800",
  progressAvailable: "bg-emerald-500",
  progressAssigned: "bg-amber-500",
  progressBroken: "bg-red-500",

  // Status dots (for the breakdown rows + footer pills)
  dotAvailable: "bg-emerald-400",
  dotAssigned: "bg-amber-400",
  dotBroken: "bg-red-400",
  dotMuted: "bg-slate-500",

  // Footer pills
  pillLiveBg: "bg-emerald-500/10",
  pillLiveText: "text-emerald-300",
  pillDieBg: "bg-red-500/10",
  pillDieText: "text-red-300",
  pillHiddenBg: "bg-slate-500/10",
  pillHiddenText: "text-slate-400",

  // Money block
  moneyBlockBg: "bg-slate-950/60",
  moneyBlockBorder: "border-slate-800/60",
  moneyLabel: "text-slate-500",
  moneyValueRevenue: "text-emerald-300",
  moneyValueCost: "text-slate-300",
  moneyValueDefault: "text-slate-100",
} as const;

/**
 * Pick the visibility-chip color token set based on a category row.
 * Avoids inline ternaries scattered through JSX.
 */
export function visibilityChipTokens(
  row: Pick<CategoryDashboardRow, "is_hidden">,
): {
  bg: string;
  text: string;
  ring: string;
  dot: string;
  label: "Hiển thị" | "Đã ẩn";
} {
  if (row.is_hidden) {
    return {
      bg: CARD_COLORS.hiddenChipBg,
      text: CARD_COLORS.hiddenChipText,
      ring: CARD_COLORS.hiddenChipRing,
      dot: CARD_COLORS.hiddenChipDot,
      label: "Đã ẩn",
    };
  }
  return {
    bg: CARD_COLORS.visibleChipBg,
    text: CARD_COLORS.visibleChipText,
    ring: CARD_COLORS.visibleChipRing,
    dot: CARD_COLORS.visibleChipDot,
    label: "Hiển thị",
  };
}
