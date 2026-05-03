import { describe, it, expect } from "vitest";
import { parseProxyLine, parseProxyText, dedupeByHostPort } from "../proxy-parse";

describe("parseProxyLine", () => {
  it("parses host:port", () => {
    const r = parseProxyLine("1.2.3.4:8080", 1);
    expect(r).toMatchObject({
      line: 1,
      host: "1.2.3.4",
      port: 8080,
      valid: true,
      username: undefined,
      password: undefined,
    });
  });

  it("parses host:port:user:pass", () => {
    const r = parseProxyLine("1.2.3.4:8080:alice:secret", 5);
    expect(r).toMatchObject({
      host: "1.2.3.4",
      port: 8080,
      username: "alice",
      password: "secret",
      valid: true,
    });
  });

  it("accepts tab separator", () => {
    const r = parseProxyLine("1.2.3.4\t8080", 1);
    expect(r.valid).toBe(true);
    expect(r.port).toBe(8080);
  });

  it("accepts comma separator", () => {
    const r = parseProxyLine("1.2.3.4,8080", 1);
    expect(r.valid).toBe(true);
  });

  it("accepts semicolon separator", () => {
    const r = parseProxyLine("1.2.3.4;8080", 1);
    expect(r.valid).toBe(true);
  });

  it("rejects empty line", () => {
    const r = parseProxyLine("   ", 7);
    expect(r.valid).toBe(false);
    expect(r.error).toBe("Empty line");
    expect(r.line).toBe(7);
  });

  it("rejects single-token line", () => {
    const r = parseProxyLine("1.2.3.4", 2);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Invalid format/);
  });

  it("rejects missing host (separator-leading)", () => {
    const r = parseProxyLine(":8080", 1);
    expect(r.valid).toBe(false);
    expect(r.error).toBe("Missing host");
  });

  it("rejects port 0", () => {
    const r = parseProxyLine("1.2.3.4:0", 1);
    expect(r.valid).toBe(false);
    expect(r.error).toBe("Invalid port");
  });

  it("rejects port > 65535", () => {
    const r = parseProxyLine("1.2.3.4:65536", 1);
    expect(r.valid).toBe(false);
    expect(r.error).toBe("Invalid port");
  });

  it("rejects non-numeric port", () => {
    const r = parseProxyLine("1.2.3.4:abc", 1);
    expect(r.valid).toBe(false);
    expect(r.error).toBe("Invalid port");
  });

  it("trims whitespace around tokens", () => {
    const r = parseProxyLine("  1.2.3.4 : 8080 : alice : secret  ", 1);
    expect(r).toMatchObject({
      host: "1.2.3.4",
      port: 8080,
      username: "alice",
      password: "secret",
      valid: true,
    });
  });

  it("preserves raw (trimmed) on invalid lines", () => {
    const r = parseProxyLine("  garbage  ", 9);
    expect(r.raw).toBe("garbage");
    expect(r.valid).toBe(false);
  });

  // Wave 23B regression — auto-parse on paste replaced the "Phân tích"
  // button. The auto-parse pipeline still calls parseProxyLine, so the
  // helper must remain stable across the rewrite.
  it("regression: returns 1-indexed line numbers (auto-parse counter)", () => {
    const r1 = parseProxyLine("1.2.3.4:80", 1);
    const r2 = parseProxyLine("1.2.3.4:81", 2);
    expect(r1.line).toBe(1);
    expect(r2.line).toBe(2);
  });
});

describe("parseProxyText", () => {
  it("parses multi-line input", () => {
    const rows = parseProxyText("1.1.1.1:80\n2.2.2.2:81:u:p\n");
    expect(rows).toHaveLength(2);
    expect(rows[0].host).toBe("1.1.1.1");
    expect(rows[1].username).toBe("u");
    expect(rows[1].password).toBe("p");
  });

  it("handles CRLF line endings", () => {
    const rows = parseProxyText("1.1.1.1:80\r\n2.2.2.2:81\r\n");
    expect(rows).toHaveLength(2);
  });

  it("skips empty lines", () => {
    const rows = parseProxyText("1.1.1.1:80\n\n\n2.2.2.2:81");
    expect(rows).toHaveLength(2);
  });

  it("returns 1-indexed line numbers AFTER skipping empties", () => {
    const rows = parseProxyText("1.1.1.1:80\n\n2.2.2.2:81");
    // Both rows are 1- and 2-indexed — empty line dropped before numbering.
    expect(rows.map((r) => r.line)).toEqual([1, 2]);
  });

  it("regression Wave 23B: 1000-line throughput stays under 50ms", () => {
    const big = Array.from({ length: 1000 }, (_, i) => `10.0.0.${i % 255}:${1000 + i}`).join("\n");
    const t0 = performance.now();
    const rows = parseProxyText(big);
    const dt = performance.now() - t0;
    expect(rows).toHaveLength(1000);
    expect(rows.every((r) => r.valid)).toBe(true);
    expect(dt).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// Wave 26-C — dedupeByHostPort regression coverage. Pre-fix the
// dedupe lived inside ProxyImport's parseContent closure and had no
// test coverage; a regression here would silently re-introduce
// "skipped 1" import surprises.
// ---------------------------------------------------------------------------
describe("dedupeByHostPort", () => {
  it("preserves order and length", () => {
    const rows = parseProxyText("1.2.3.4:80\n5.6.7.8:81\n9.10.11.12:82");
    const out = dedupeByHostPort(rows);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.host)).toEqual(["1.2.3.4", "5.6.7.8", "9.10.11.12"]);
  });

  it("flags 2nd+ occurrences of the same host:port as invalid", () => {
    const rows = parseProxyText(
      "1.2.3.4:80:userA:passA\n1.2.3.4:80:userB:passB\n5.6.7.8:81",
    );
    const out = dedupeByHostPort(rows);
    expect(out[0].valid).toBe(true);
    expect(out[1].valid).toBe(false);
    expect(out[1].error).toContain("Trùng dòng 1");
    expect(out[1].error).toContain("1.2.3.4:80");
    expect(out[2].valid).toBe(true);
  });

  it("treats different ports on the same host as distinct", () => {
    const rows = parseProxyText("1.2.3.4:80\n1.2.3.4:81");
    const out = dedupeByHostPort(rows);
    expect(out.every((r) => r.valid)).toBe(true);
  });

  it("does NOT touch already-invalid rows (preserves their error)", () => {
    const rows = parseProxyText("1.2.3.4:99999\n1.2.3.4:99999");
    const out = dedupeByHostPort(rows);
    // Both invalid because port out of range; dedupe doesn't second-guess.
    expect(out[0].valid).toBe(false);
    expect(out[0].error).toContain("port");
    expect(out[1].valid).toBe(false);
    expect(out[1].error).toContain("port");
  });

  it("returns a new array (does not mutate input)", () => {
    const rows = parseProxyText("1.2.3.4:80\n1.2.3.4:80");
    const out = dedupeByHostPort(rows);
    expect(out).not.toBe(rows);
    expect(rows[1].valid).toBe(true); // input untouched
    expect(out[1].valid).toBe(false); // output flagged
  });

  it("references the FIRST line in the duplicate error message", () => {
    const rows = parseProxyText(
      "10.0.0.1:8000\n10.0.0.2:8000\n10.0.0.1:8000\n10.0.0.1:8000",
    );
    const out = dedupeByHostPort(rows);
    expect(out[0].valid).toBe(true);
    expect(out[2].error).toContain("Trùng dòng 1");
    expect(out[3].error).toContain("Trùng dòng 1");
  });

  it("handles 1000-row dedupe under 25ms", () => {
    // 500 unique + 500 dup
    const lines: string[] = [];
    for (let i = 0; i < 500; i++) lines.push(`10.0.0.${i % 255}:${1000 + i}`);
    for (let i = 0; i < 500; i++) lines.push(`10.0.0.${i % 255}:${1000 + i}`);
    const rows = parseProxyText(lines.join("\n"));
    const t0 = performance.now();
    const out = dedupeByHostPort(rows);
    const dt = performance.now() - t0;
    const validCount = out.filter((r) => r.valid).length;
    expect(validCount).toBe(500);
    expect(dt).toBeLessThan(25);
  });
});
