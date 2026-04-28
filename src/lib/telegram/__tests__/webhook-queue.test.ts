import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  acquireSlot,
  releaseSlot,
  _resetQueueForTests,
  _getQueueDepthForTests,
} from "@/lib/telegram/webhook-queue";

/**
 * Wave 22D-4 regression tests for webhook-queue underflow guard.
 *
 * Bug pre-22D-4: `releaseSlot()` did `activeCount--` unconditionally.
 * A double-release (caller bug or sync exception bypass) drove the
 * counter negative; once negative, the concurrency cap was silently
 * disabled — bursts hit Supabase's connection pool unchecked, risking
 * "remaining connection slots are reserved" errors at random.
 *
 * The fix: guard `activeCount > 0` and log if the call would underflow.
 * These tests pin both the guard AND the normal-operation behaviour so
 * any future drift breaks loudly.
 */

describe("webhook-queue Wave 22D-4 underflow guard", () => {
  beforeEach(() => {
    _resetQueueForTests();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("acquires + releases keeps activeCount at 0", async () => {
    await acquireSlot();
    expect(_getQueueDepthForTests().active).toBe(1);
    releaseSlot();
    expect(_getQueueDepthForTests().active).toBe(0);
  });

  it("releaseSlot called with no active slot does NOT underflow", () => {
    expect(_getQueueDepthForTests().active).toBe(0);
    releaseSlot(); // double-release simulation
    // Counter must NOT go negative — that would silently disable the cap.
    expect(_getQueueDepthForTests().active).toBe(0);
  });

  it("logs an error when releaseSlot underflows (so the bug surfaces)", () => {
    const errSpy = vi.spyOn(console, "error");
    releaseSlot();
    expect(errSpy).toHaveBeenCalledOnce();
    expect(errSpy.mock.calls[0][0]).toMatch(/double-release/);
  });

  it("multiple acquire/release pairs balance correctly", async () => {
    await acquireSlot();
    await acquireSlot();
    await acquireSlot();
    expect(_getQueueDepthForTests().active).toBe(3);
    releaseSlot();
    releaseSlot();
    releaseSlot();
    expect(_getQueueDepthForTests().active).toBe(0);
    // One extra release — must NOT underflow.
    releaseSlot();
    expect(_getQueueDepthForTests().active).toBe(0);
  });

  it("after underflow attempt, normal acquire still works", async () => {
    releaseSlot(); // attempted underflow, should be ignored
    await acquireSlot();
    expect(_getQueueDepthForTests().active).toBe(1);
    releaseSlot();
    expect(_getQueueDepthForTests().active).toBe(0);
  });
});
