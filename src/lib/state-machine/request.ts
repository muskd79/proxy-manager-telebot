/**
 * Proxy request state machine.
 *
 * Encodes the allowed transitions of a proxy request row so API routes and
 * bot callbacks cannot push a request into an illegal state (e.g. reviving
 * a cancelled request by setting it back to pending).
 *
 * Valid lifecycle:
 *   pending --------> approved -----> (terminal; proxy assigned)
 *   pending --------> auto_approved - (terminal; proxy assigned)
 *   pending --------> rejected ----- (terminal)
 *   pending --------> expired ------ (terminal; TTL elapsed without action)
 *   pending --------> cancelled ---- (terminal; user cancelled)
 *   approved/auto_approved --------- (terminal — no further transitions)
 *
 * `pending` is the only non-terminal state. Once a request leaves pending,
 * it stays in its final status forever; a new request must be created.
 */

import { createMachine } from "./create-machine";
import { RequestStatus } from "@/types/database";

export const requestMachine = createMachine<RequestStatus>({
  [RequestStatus.Pending]: [
    RequestStatus.Approved,
    RequestStatus.AutoApproved,
    RequestStatus.Rejected,
    RequestStatus.Expired,
    RequestStatus.Cancelled,
  ],
  [RequestStatus.Approved]: [],
  [RequestStatus.AutoApproved]: [],
  [RequestStatus.Rejected]: [],
  [RequestStatus.Expired]: [],
  [RequestStatus.Cancelled]: [],
});

/** Terminal statuses have no outgoing transitions. */
export function isTerminalRequestStatus(status: RequestStatus): boolean {
  return requestMachine.allowedFrom(status).length === 0;
}
