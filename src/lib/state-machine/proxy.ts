/**
 * Proxy lifecycle state machine.
 *
 * Models the flow of a proxy row through its useful life. Invalid transitions
 * (e.g. banned -> available without going through maintenance) throw at the
 * boundary instead of silently corrupting state.
 *
 * Valid transitions:
 *   available <-> assigned        (normal rental flow)
 *   available  -> maintenance     (admin takes proxy offline)
 *   assigned   -> maintenance     (admin revokes and parks for check)
 *   assigned   -> banned          (marked dead after ban report)
 *   assigned   -> expired         (rental TTL hit)
 *   expired    -> available       (admin renews/reuses)
 *   expired    -> maintenance     (needs re-check before reuse)
 *   banned     -> maintenance     (re-check before possibly reviving)
 *   maintenance-> available       (passes checks)
 *   maintenance-> banned          (fails checks)
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
  ],
  [ProxyStatus.Expired]: [ProxyStatus.Available, ProxyStatus.Maintenance],
  [ProxyStatus.Banned]: [ProxyStatus.Maintenance],
  [ProxyStatus.Maintenance]: [ProxyStatus.Available, ProxyStatus.Banned],
});
