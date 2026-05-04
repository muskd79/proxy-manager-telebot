/**
 * Wave 26-D-post1/D — pure helpers shared across trash-proxies /
 * trash-users / trash-requests. Pre-fix each view rebuilt date math
 * inline, drifted on label tone (red vs amber), and showed only an
 * absolute deleted_at timestamp without a countdown.
 *
 * 30-day retention rule lives in the cleanup cron (api/cron/cleanup).
 *
 * Wave 26-D bug hunt v2 [Debugger #2] — re-export
 * TRASH_AUTO_CLEAN_DAYS from lib/constants instead of duplicating it.
 * Pre-fix: this file had its own `TRASH_RETENTION_DAYS = 30` and the
 * cron read TRASH_AUTO_CLEAN_DAYS from constants — drift on the next
 * edit was guaranteed (admin changes one but not the other → UI
 * countdown disagrees with cron purge time).
 */

import { TRASH_AUTO_CLEAN_DAYS } from "@/lib/constants";

// Single source of truth. UI uses the same value the cron uses.
export const TRASH_RETENTION_DAYS = TRASH_AUTO_CLEAN_DAYS;

export interface TrashCountdown {
  /** Days remaining until permanent deletion. Floor at 0. */
  daysLeft: number;
  /** "Còn 12 ngày" / "Hôm nay sẽ xoá" / "Đã quá hạn" */
  label: string;
  /** Tailwind tone bucket for the badge color. */
  tone: "ok" | "warn" | "danger";
}

/**
 * Compute days remaining until auto-purge for a soft-deleted row.
 * `deletedAt` null/undefined → unknown bucket (treated as "danger"
 * since the row is in trash without a timestamp — corner case).
 *
 * Pure + deterministic when `now` is provided. Vitest covers each
 * threshold transition.
 */
export function computeTrashCountdown(
  deletedAt: string | null | undefined,
  now: Date = new Date(),
): TrashCountdown {
  if (!deletedAt) {
    return { daysLeft: 0, label: "Không rõ", tone: "danger" };
  }
  const deletedTs = new Date(deletedAt).getTime();
  if (Number.isNaN(deletedTs)) {
    return { daysLeft: 0, label: "Không rõ", tone: "danger" };
  }
  const purgeAt = deletedTs + TRASH_RETENTION_DAYS * 86_400_000;
  const msLeft = purgeAt - now.getTime();
  const daysLeft = Math.max(0, Math.ceil(msLeft / 86_400_000));

  if (msLeft <= 0) {
    return { daysLeft: 0, label: "Đã quá hạn", tone: "danger" };
  }
  if (daysLeft <= 1) {
    return { daysLeft, label: "Hôm nay sẽ xoá", tone: "danger" };
  }
  if (daysLeft <= 7) {
    return { daysLeft, label: `Còn ${daysLeft} ngày`, tone: "warn" };
  }
  return { daysLeft, label: `Còn ${daysLeft} ngày`, tone: "ok" };
}

/**
 * Format an ISO timestamp to a vi-VN absolute string suitable for
 * the "Xoá lúc" column. Returns "—" when null.
 */
export function formatDeletedAt(deletedAt: string | null | undefined): string {
  if (!deletedAt) return "—";
  const d = new Date(deletedAt);
  // toLocaleString does NOT throw on invalid date — it returns the
  // string "Invalid Date". Guard explicitly via getTime().
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}
