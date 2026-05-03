/**
 * Proxy lifecycle state machine.
 *
 * Models the flow of a proxy row through its useful life. Invalid transitions
 * (e.g. banned -> available without going through maintenance) throw at the
 * boundary instead of silently corrupting state.
 *
 * Valid transitions:
 *   available  <-> assigned          (normal rental flow)
 *   available   -> maintenance       (admin takes proxy offline)
 *   assigned    -> maintenance       (admin revokes and parks for check)
 *   assigned    -> banned            (admin marks dead immediately)
 *   assigned    -> expired           (rental TTL hit)
 *   expired     -> available         (admin renews/reuses)
 *   expired     -> maintenance       (needs re-check before reuse)
 *   banned      -> maintenance       (re-check before possibly reviving)
 *   maintenance -> available         (passes checks)
 *   maintenance -> banned            (fails checks)
 *
 * Wave 26-D — warranty mechanism transitions:
 *   assigned         -> reported_broken   (user clicks "Báo lỗi" in bot)
 *   reported_broken  -> maintenance       (admin approves warranty,
 *                                          default flow A7=b → proxy
 *                                          parked for re-test)
 *   reported_broken  -> banned            (admin approves warranty +
 *                                          ticks "đồng thời mark banned"
 *                                          checkbox — proxy confirmed
 *                                          dead, no re-test needed)
 *   reported_broken  -> assigned          (admin REJECTS warranty —
 *                                          revert to assigned, user
 *                                          keeps the proxy as-is)
 *
 * Decision rationale captured in BRAINSTORM_PROXIES_2026-05-03.md
 * vòng 4 (A7=b synthesis from architect + brainstormer agents):
 *   - `reported_broken` is a distinct state (not just "assigned with
 *     a flag") so /getproxy distribution queries can filter it out
 *     trivially via WHERE status = 'available'.
 *   - Default exit (warranty approved) → maintenance (NOT banned)
 *     because user reports have non-trivial false-positive rate;
 *     auto-banning every reported proxy torches recoverable inventory.
 *   - Admin checkbox preserves the option to fast-path → banned when
 *     they're confident the proxy is dead (vendor confirmed, IP block
 *     evidence, etc).
 *   - Reject path → assigned (revert) so the user keeps the proxy if
 *     admin determines the report was a misclick / fixable user-side
 *     issue.
 */

import { createMachine } from "./create-machine";
import { ProxyStatus } from "@/types/database";

export const proxyMachine = createMachine<ProxyStatus>({
  [ProxyStatus.Available]: [ProxyStatus.Assigned, ProxyStatus.Maintenance],
  [ProxyStatus.Assigned]: [
    ProxyStatus.Available,
    ProxyStatus.Maintenance,
    ProxyStatus.Banned,
    ProxyStatus.Expired,
    // Wave 26-D — user-triggered via bot warranty button.
    ProxyStatus.ReportedBroken,
  ],
  // Wave 26-D — `reported_broken` is the warranty-pending state.
  [ProxyStatus.ReportedBroken]: [
    // Admin approves warranty (default flow): park proxy for re-test.
    ProxyStatus.Maintenance,
    // Admin approves warranty + checkbox "đồng thời mark banned":
    // skip maintenance, go straight to banned.
    ProxyStatus.Banned,
    // Admin rejects warranty: revert to assigned (user keeps proxy).
    ProxyStatus.Assigned,
  ],
  [ProxyStatus.Expired]: [ProxyStatus.Available, ProxyStatus.Maintenance],
  [ProxyStatus.Banned]: [ProxyStatus.Maintenance],
  [ProxyStatus.Maintenance]: [ProxyStatus.Available, ProxyStatus.Banned],
});
