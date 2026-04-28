import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Wave 22D-4 regression test for notifyAllAdmins fanout reliability.
 *
 * Bug pre-22D-4: a for-loop of fire-and-forget `sendTelegramMessage(...)
 * .catch(console.error)`. If Telegram returned 429 on admin #2, the
 * loop kept firing but the failures were drowned in console.error
 * calls indistinguishable from each other — and there was no Promise
 * binding the caller to the dispatch outcomes.
 *
 * The fix: Promise.allSettled + structured per-recipient logging.
 * These tests pin:
 *   1. Every admin gets a send attempt (no early bail on first failure).
 *   2. Failures are logged with the Telegram ID for incident response.
 *   3. The function awaits all dispatches (caller can rely on the
 *      `await` returning after all sends are settled).
 */

const mockSendTelegramMessage = vi.fn();

vi.mock("@/lib/telegram/send", () => ({
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
}));

const mockSelect = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: () => ({
      select: (...args: unknown[]) => {
        // Two paths: admins query and settings query.
        // Both end with chained .eq(...) / .single() — return the
        // mockSelect chain that resolves to whatever the test queued.
        return mockSelect(...args);
      },
    }),
  },
}));

import { notifyAllAdmins } from "@/lib/telegram/notify-admins";

function setupMockAdmins(telegramIds: number[]) {
  // First call: admins table .select("telegram_id").not(...).eq(...)
  // Returns rows with telegram_id field.
  // Second call: settings table .select("value").eq(...).single()
  // Returns null (no fallback admin_telegram_ids).
  let callCount = 0;
  mockSelect.mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      // admins query — chain .not().eq()
      return {
        not: () => ({
          eq: () =>
            Promise.resolve({
              data: telegramIds.map((id) => ({ telegram_id: id })),
              error: null,
            }),
        }),
      };
    }
    // settings query — chain .eq().single()
    return {
      eq: () => ({
        single: () => Promise.resolve({ data: null, error: null }),
      }),
    };
  });
}

describe("Wave 22D-4 — notifyAllAdmins reliability", () => {
  beforeEach(() => {
    mockSendTelegramMessage.mockReset();
    mockSelect.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("attempts to send to ALL admins even if the first fails", async () => {
    setupMockAdmins([100, 200, 300]);
    // Admin #1 fails (rejected); admins #2 and #3 succeed.
    mockSendTelegramMessage
      .mockRejectedValueOnce(new Error("Telegram 429"))
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true });

    await notifyAllAdmins("hello");

    // CRITICAL: pre-22D-4 bug was that admins #2 and #3 still got
    // attempted (it was a for-loop of fire-and-forget) — but the
    // FAILURE on admin #1 was swallowed without identifying which
    // admin missed it. Now we should see:
    //   - 3 send attempts
    //   - 1 console.error tagged with telegram_id=100
    expect(mockSendTelegramMessage).toHaveBeenCalledTimes(3);
    expect(mockSendTelegramMessage).toHaveBeenNthCalledWith(1, 100, "hello", undefined);
    expect(mockSendTelegramMessage).toHaveBeenNthCalledWith(2, 200, "hello", undefined);
    expect(mockSendTelegramMessage).toHaveBeenNthCalledWith(3, 300, "hello", undefined);

    const errSpy = vi.mocked(console.error);
    expect(errSpy).toHaveBeenCalled();
    const errorCall = errSpy.mock.calls.find((c) =>
      String(c[0]).includes("telegram_id=100"),
    );
    expect(errorCall).toBeDefined();
  });

  it("logs the offending telegram_id when sendTelegramMessage returns success=false", async () => {
    setupMockAdmins([42]);
    mockSendTelegramMessage.mockResolvedValueOnce({
      success: false,
      error: "Bot was blocked by user",
    });

    await notifyAllAdmins("test");

    const errSpy = vi.mocked(console.error);
    const errorCall = errSpy.mock.calls.find((c) =>
      String(c[0]).includes("telegram_id=42"),
    );
    expect(errorCall).toBeDefined();
  });

  it("awaits all sends — caller can rely on completion (was fire-and-forget before)", async () => {
    setupMockAdmins([1, 2]);
    let resolved = 0;
    mockSendTelegramMessage.mockImplementation(
      () =>
        new Promise((res) => {
          setTimeout(() => {
            resolved++;
            res({ success: true });
          }, 5);
        }),
    );

    await notifyAllAdmins("hi");

    // After await, both sends must have resolved. Pre-22D-4's
    // fire-and-forget pattern would return immediately with resolved=0.
    expect(resolved).toBe(2);
  });

  it("respects excludeTelegramId option", async () => {
    setupMockAdmins([10, 20, 30]);
    mockSendTelegramMessage.mockResolvedValue({ success: true });

    await notifyAllAdmins("ping", { excludeTelegramId: 20 });

    // Admin #20 must NOT receive a send call.
    expect(mockSendTelegramMessage).toHaveBeenCalledTimes(2);
    const calledIds = mockSendTelegramMessage.mock.calls.map((c) => c[0]);
    expect(calledIds).toEqual([10, 30]);
  });

  it("returns immediately with no error when there are zero admins", async () => {
    setupMockAdmins([]);
    await expect(notifyAllAdmins("noop")).resolves.toBeUndefined();
    expect(mockSendTelegramMessage).not.toHaveBeenCalled();
  });
});
