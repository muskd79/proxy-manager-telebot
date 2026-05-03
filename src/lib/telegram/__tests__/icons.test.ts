import { describe, it, expect } from "vitest";
import { Icon } from "../icons";

/**
 * Wave 25-pre3 (Pass 5.1) — pin the icon vocabulary. If a future
 * refactor accidentally swaps `[X]` for an emoji, or reuses `[OK]`
 * for warnings, these assertions force a conscious change with a
 * clear rationale in the diff.
 *
 * The vocabulary is documented in src/lib/telegram/icons.ts; this
 * test is the regression gate. To change a value: update both the
 * constant AND this test in the same commit.
 */
describe("Icon vocabulary (Wave 25-pre3 source-of-truth)", () => {
  it("error / warn / info / ok / neutral are stable", () => {
    expect(Icon.error).toBe("[X]");
    expect(Icon.warn).toBe("[!]");
    expect(Icon.info).toBe("[i]");
    expect(Icon.ok).toBe("[OK]");
    expect(Icon.neutral).toBe("[-]");
  });

  it("the 5 keys are exhaustive (no extras yet)", () => {
    expect(Object.keys(Icon).sort()).toEqual([
      "error",
      "info",
      "neutral",
      "ok",
      "warn",
    ]);
  });

  it("no value contains a Unicode emoji (matches no-emoji policy)", () => {
    const EMOJI_RE = /[\u{1F300}-\u{1FAFF}]/u;
    for (const [key, value] of Object.entries(Icon)) {
      expect(EMOJI_RE.test(value), `Icon.${key} contains emoji: "${value}"`).toBe(
        false,
      );
    }
  });

  it("each value uses ASCII brackets to keep mobile-Telegram-safe width", () => {
    for (const [key, value] of Object.entries(Icon)) {
      expect(value.startsWith("["), `Icon.${key} should start with "["`).toBe(
        true,
      );
      expect(value.endsWith("]"), `Icon.${key} should end with "]"`).toBe(true);
      expect(value.length, `Icon.${key} value too wide: "${value}"`).toBeLessThanOrEqual(
        4,
      );
    }
  });
});
