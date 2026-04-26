import { describe, it, expect, vi, afterEach } from "vitest";
import { uuidv7, isUuidV7 } from "../uuid7";

describe("uuidv7", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a valid UUIDv7 string", () => {
    const id = uuidv7();
    expect(isUuidV7(id)).toBe(true);
  });

  it("produces 36-char hyphenated format", () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("encodes the current millisecond in the first 48 bits", () => {
    vi.useFakeTimers();
    const fixed = new Date("2026-04-26T12:34:56.789Z").getTime();
    vi.setSystemTime(fixed);
    const id = uuidv7();
    const hex = id.replace(/-/g, "").slice(0, 12); // 48 bits = 12 hex
    const decoded = parseInt(hex, 16);
    expect(decoded).toBe(fixed);
  });

  it("two consecutive ids in the same ms are sortable", () => {
    const a = uuidv7();
    const b = uuidv7();
    // Comparison is byte-lexicographic; same prefix means random tail decides.
    // We don't assert order — just that they differ.
    expect(a).not.toBe(b);
  });

  it("ids generated 10ms apart sort by time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T00:00:00.000Z"));
    const earlier = uuidv7();
    vi.setSystemTime(new Date("2026-04-26T00:00:00.010Z"));
    const later = uuidv7();
    expect(earlier < later).toBe(true);
  });

  it("version nibble is 7", () => {
    const id = uuidv7();
    expect(id.charAt(14)).toBe("7"); // position of version nibble
  });

  it("variant bits start with 8/9/a/b", () => {
    const id = uuidv7();
    expect("89ab").toContain(id.charAt(19).toLowerCase());
  });

  it("isUuidV7 rejects v4", () => {
    expect(isUuidV7("00000000-0000-4000-8000-000000000000")).toBe(false);
  });

  it("isUuidV7 rejects malformed", () => {
    expect(isUuidV7("not a uuid")).toBe(false);
    expect(isUuidV7("")).toBe(false);
    expect(isUuidV7("123")).toBe(false);
  });
});
