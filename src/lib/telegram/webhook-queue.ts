/**
 * Simple in-memory request queue to prevent connection pool exhaustion.
 * Limits concurrent webhook processing to MAX_CONCURRENT.
 * Excess requests are queued and processed when slots free up.
 *
 * Why 50? Each handler uses ~5 DB queries average.
 * 50 x 5 = 250 peak connections, well within the 450 Supabase limit.
 * Leaves ~200 connections for admin dashboard, cron jobs, and other API routes.
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
  activeCount--;
  if (queue.length > 0) {
    const next = queue.shift()!;
    clearTimeout(next.timer);
    activeCount++;
    next.resolve();
  }
}

/** Current queue depth for monitoring */
export function getQueueStats(): { active: number; queued: number } {
  return { active: activeCount, queued: queue.length };
}
