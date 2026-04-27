import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useImportWizard } from "../useImportWizard";

/**
 * Wave 22E-2 BUG FIX (B8) regression test.
 *
 * Pre-fix the "Back to paste" button on step 2 called
 * `setPasteText(state.pasteText)` — a no-op self-set with no step
 * change. The user clicked but nothing happened.
 *
 * The fix: `BACK_TO_PASTE` reducer action + `backToPaste` callback.
 * This test pins the contract so a refactor can't silently regress.
 */
describe("useImportWizard — Wave 22E-2 regression (B8)", () => {
  it("backToPaste flips step from 'parsed' back to 'paste'", () => {
    const { result } = renderHook(() => useImportWizard());

    // Drive into step 'parsed'
    act(() => {
      result.current.setPasteText("203.0.113.1:8080");
    });
    act(() => {
      result.current.parsePaste();
    });
    expect(result.current.state.step).toBe("parsed");

    // Now click Back to paste
    act(() => {
      result.current.backToPaste();
    });
    expect(result.current.state.step).toBe("paste");
  });

  it("backToPaste preserves pasteText so user doesn't lose input", () => {
    const { result } = renderHook(() => useImportWizard());
    const original = "203.0.113.1:8080\n203.0.113.2:8080";

    act(() => {
      result.current.setPasteText(original);
    });
    act(() => {
      result.current.parsePaste();
    });
    act(() => {
      result.current.backToPaste();
    });

    expect(result.current.state.pasteText).toBe(original);
  });

  it("preserves the same idempotency key across the back-and-forth navigation", () => {
    // The wizard generates a UUIDv7 ONCE per session and reuses it on
    // submit. If "back to paste" silently regenerated the key, a retry
    // after navigation would create a duplicate import row.
    const { result } = renderHook(() => useImportWizard());
    const initialKey = result.current.state.idempotencyKey;

    act(() => {
      result.current.setPasteText("203.0.113.1:8080");
    });
    act(() => {
      result.current.parsePaste();
    });
    act(() => {
      result.current.backToPaste();
    });

    expect(result.current.state.idempotencyKey).toBe(initialKey);
  });
});
