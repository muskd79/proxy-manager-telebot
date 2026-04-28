/**
 * Simple in-memory request queue to prevent connection pool exhaustion.
 * Limits concurrent webhook processing to MAX_CONCURRENT.
 * Excess requests are queued and processed when slots free up.
 *
 * Why 50? Each handler uses ~5 DB queries average.
 * 50 x 5 = 250 peak connections, well within the 450 Supabase limit.
 * Leaves ~200 connections for admin dashboard, cron jobs, and other API routes.
 *
 * Wave 22D-4 reliability fix:
 *   releaseSlot previously did `activeCount--` unconditionally. A
 *   double-release (caller bug, or a sync exception bypassing the
 *   `try { acquireSlot } finally { releaseSlot }` block) drove the
 *   counter negative. Once negative, `activeCount < MAX_CONCURRENT`
 *   is always true and the concurrency limit is silently disabled —
 *   any subsequent burst hits the DB connection pool unchecked.
 *   Now we guard `activeCount > 0` and log if a release would
 *   underflow, so the bug surfaces in logs instead of corrupting
 *   the gate.
 */

const MAX_CONCURRENT = 50;
const QUEUE_TIMEOUT_MS = 10_000; // 10s max wait in queue before dropping

let activeCount = 0;
const queue: Array<{
  resolve: (value: void) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}> = [];

export async function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return;
  }

  // Wait for a slot with timeout
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      // Remove from queue on timeout
      const idx = queue.findIndex((item) => item.resolve === resolve);
      if (idx !== -1) queue.splice(idx, 1);
      reject(new Error("Webhook queue timeout"));
    }, QUEUE_TIMEOUT_MS);

    queue.push({ resolve, reject, timer });
  });
}

export function releaseSlot(): void {
  // Wave 22D-4: guard against underflow. If activeCount is already 0,
  // the caller has a double-release bug — log it and bail rather than
  // letting the counter go negative (which would silently disable the
  // concurrency cap).
  if (activeCount <= 0) {
    console.error(
      "[webhook-queue] releaseSlot called with activeCount <= 0; ignoring " +
        "(possible double-release; investigate the calling try/finally)",
    );
    return;
  }
  activeCount--;
  if (queue.length > 0) {
    const next = queue.shift()!;
    clearTimeout(next.timer);
    activeCount++;
    next.resolve();
  }
}

/**
 * Test-only reset. Lets unit tests start each case from a clean
 * counter without restarting the module.
 *
 * NOTE: not exported via the production index — only direct imports
 * in test files reach this. Production code never calls it.
 */
export function _resetQueueForTests(): void {
  activeCount = 0;
  queue.length = 0;
}

/**
 * Read-only counter view for tests. Avoids exposing the mutable
 * module state directly.
 */
export function _getQueueDepthForTests(): { active: number; queued: number } {
  return { active: activeCount, queued: queue.length };
}
