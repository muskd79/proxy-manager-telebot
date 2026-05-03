/**
 * Wave 25-pre4 (Pass 3.2) — first-time delight footer.
 *
 * After a user receives their FIRST lifetime proxy, the assigned-
 * proxy message gets a one-time footer pointing at the next obvious
 * action (`/checkproxy` to test it, `/myproxies` to view all). After
 * that, the footer never appears again — preserves emotional weight
 * of the first success.
 *
 * Backed by `tele_users.first_proxy_at` (added in migration 053).
 * Backfill in 053 set the column for users who already had assigned
 * proxies; new users get NULL → footer fires once on first
 * assignment → we set the timestamp so subsequent assignments skip
 * the footer.
 *
 * The helper itself is async because we need to write the timestamp
 * inline. We do the write BEFORE returning the footer so a crash
 * between footer-show and write-success can't double-fire — worst
 * case: user gets the footer once, no permanent state.
 *
 * Future milestones (100th proxy, first month anniversary, etc.) go
 * in the same module under their own helper. Each milestone owns
 * its own DB column.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SupportedLanguage } from "@/types/telegram";

const FOOTER_VI =
  "\n\n_Test proxy này bằng /checkproxy. Xem tất cả: /myproxies._";
const FOOTER_EN =
  "\n\n_Test it with /checkproxy. View all: /myproxies._";

/**
 * Returns the first-proxy footer (with leading double newline) when
 * this is the user's first lifetime assignment. Returns "" otherwise.
 *
 * Side effect: sets `first_proxy_at = now()` when it returns the
 * footer, so subsequent calls within the same lifetime get "".
 *
 * Pass `userId` (uuid) and `firstProxyAt` (the existing column value
 * from the user row you already loaded). Avoids a redundant DB read
 * for the common case where the caller already has the row.
 */
export async function getFirstProxyFooter(
  userId: string,
  firstProxyAt: string | null,
  lang: SupportedLanguage,
): Promise<string> {
  if (firstProxyAt) return ""; // Not the first lifetime proxy.

  // Mark milestone reached. Use NOW() server-side to avoid client-clock skew.
  // The UPDATE is conditional on first_proxy_at IS NULL so concurrent
  // assignments (rare — same user clicking two buttons fast) don't
  // double-fire.
  const { data } = await supabaseAdmin
    .from("tele_users")
    .update({ first_proxy_at: new Date().toISOString() })
    .eq("id", userId)
    .is("first_proxy_at", null)
    .select("id");

  // If the conditional UPDATE didn't match (someone else won the race),
  // skip the footer.
  if (!data || data.length === 0) return "";

  return lang === "vi" ? FOOTER_VI : FOOTER_EN;
}
