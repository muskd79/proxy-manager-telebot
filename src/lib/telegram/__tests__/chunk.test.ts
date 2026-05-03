import { describe, it, expect } from "vitest";
import { chunkMessage } from "../chunk";

/**
 * Wave 25-pre4 (Pass 2.1) — pin chunkMessage behavior so future
 * regressions on /myproxies / /checkproxy / bulk-proxy don't return
 * Telegram 400 "MESSAGE_TOO_LONG".
 */
describe("chunkMessage", () => {
  it("returns input unchanged when ≤ max", () => {
    expect(chunkMessage("hello", 100)).toEqual(["hello"]);
    expect(chunkMessage("a".repeat(100), 100)).toEqual(["a".repeat(100)]);
  });

  it("splits on newline boundaries when possible", () => {
    const text = "line1\nline2\nline3";
    const chunks = chunkMessage(text, 11);
    // "line1\nline2" is 11 chars; "line3" is the second chunk.
    expect(chunks).toEqual(["line1\nline2", "line3"]);
  });

  it("never produces a chunk larger than max", () => {
    const text = Array.from({ length: 50 }, (_, i) => `row-${i}-data`).join("\n");
    const chunks = chunkMessage(text, 80);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(80);
    }
    // Reassembly: chunks rejoined with newline must equal original
    // (since we split only on existing newlines).
    expect(chunks.join("\n")).toBe(text);
  });

  it("hard-cuts a single line longer than max", () => {
    const longLine = "x".repeat(120);
    const chunks = chunkMessage(longLine, 50);
    expect(chunks).toEqual(["x".repeat(50), "x".repeat(50), "x".repeat(20)]);
  });

  it("preserves Markdown lines (does not cut mid-line at boundary)", () => {
    const text = "*bold line one*\n_italic line_\n`code line`";
    const chunks = chunkMessage(text, 16);
    // First chunk fits "*bold line one*" (15 chars)
    expect(chunks[0]).toBe("*bold line one*");
    expect(chunks).toContain("_italic line_");
    expect(chunks).toContain("`code line`");
  });

  it("default max is 3800", () => {
    const exact = "a".repeat(3800);
    expect(chunkMessage(exact)).toEqual([exact]);
    const over = "a".repeat(3801);
    const chunks = chunkMessage(over);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(3800);
    }
  });

  it("empty input returns single empty chunk", () => {
    expect(chunkMessage("")).toEqual([""]);
  });
});
