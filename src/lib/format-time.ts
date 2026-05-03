/**
 * Wave 26-C — Vietnamese relative-time formatter for the proxy admin UI.
 *
 * Pre-fix the proxy table desktop column (`assigned_at`) showed only an
 * absolute timestamp ("28/04/2026 14:32") which forced admins to mentally
 * subtract dates to know when a proxy was given out. The mobile card view
 * had the same problem. User feedback: "30 ngày trước" — admins want a
 * glanceable "how long ago" that switches to absolute date for older rows.
 *
 * Rules (matches the conventional Telegram/Facebook-style relative time):
 *   < 60 s        → "Vừa xong"
 *   < 60 min      → "{N} phút trước"
 *   < 24 h        → "{N} giờ trước"
 *   < 30 day      → "{N} ngày trước"
 *   < 365 day     → "{N} tháng trước"
 *   ≥ 365 day     → absolute "DD/MM/YYYY"
 *
 * Future tense is mirrored ("trong N phút", "trong N ngày") for cases
 * where the input is in the future (rare for assigned_at but useful
 * for expires_at / scheduled fields).
 *
 * Pure function, deterministic — accepts an explicit `now` param for
 * tests. Library-free (no date-fns dep) so the table renders without
 * pulling locale data.
 */

export interface FormatRelativeOptions {
  /** Reference time. Defaults to `new Date()`. */
  now?: Date;
  /**
   * If true, ALWAYS return absolute date — bypasses relative formatting.
   * Useful when the caller needs deterministic output (e.g. CSV export).
   */
  absolute?: boolean;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY; // approximate — admin UI only, not billing
const YEAR = 365 * DAY;

function formatAbsoluteDate(d: Date): string {
  // dd/MM/yyyy in vi-VN locale. Using toLocaleDateString to inherit the
  // user's regional formatting; `vi-VN` always renders DD/MM/YYYY.
  return d.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatRelativeVi(
  input: string | Date | null | undefined,
  opts: FormatRelativeOptions = {},
): string {
  if (!input) return "-";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "-";

  if (opts.absolute) return formatAbsoluteDate(d);

  const now = opts.now ?? new Date();
  const diff = now.getTime() - d.getTime(); // positive = past
  const past = diff >= 0;
  const abs = Math.abs(diff);

  // Within "just now" window — collapse seconds + sub-minute drift.
  if (abs < MIN) return "Vừa xong";

  if (abs < HOUR) {
    const n = Math.floor(abs / MIN);
    return past ? `${n} phút trước` : `trong ${n} phút`;
  }
  if (abs < DAY) {
    const n = Math.floor(abs / HOUR);
    return past ? `${n} giờ trước` : `trong ${n} giờ`;
  }
  if (abs < MONTH) {
    const n = Math.floor(abs / DAY);
    return past ? `${n} ngày trước` : `trong ${n} ngày`;
  }
  if (abs < YEAR) {
    const n = Math.floor(abs / MONTH);
    return past ? `${n} tháng trước` : `trong ${n} tháng`;
  }

  // ≥ 1 year: switch to absolute date — relative loses meaning.
  return formatAbsoluteDate(d);
}

/**
 * Wave 26-C — pair value used by tooltips on the table:
 *   - `relative` is the at-a-glance label
 *   - `absolute` is the full timestamp shown on hover
 *
 * Caller renders `<span title={absolute}>{relative}</span>`.
 */
export function formatRelativeWithTitle(
  input: string | Date | null | undefined,
  opts: FormatRelativeOptions = {},
): { relative: string; absolute: string } {
  if (!input) return { relative: "-", absolute: "-" };
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return { relative: "-", absolute: "-" };
  return {
    relative: formatRelativeVi(d, opts),
    absolute: d.toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}
