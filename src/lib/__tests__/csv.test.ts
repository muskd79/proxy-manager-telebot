import { describe, it, expect } from "vitest";
import {
  buildCsv,
  buildCsvHeader,
  buildCsvRow,
  parseProxyCsv,
  maskSecret,
} from "../csv";

describe("buildCsv — formula injection protection", () => {
  interface Row {
    name: string;
    count: number;
  }

  const cols = [
    { header: "name", value: (r: Row) => r.name },
    { header: "count", value: (r: Row) => r.count },
  ];

  it("escapes a leading '=' (formula injection)", () => {
    const out = buildCsv([{ name: "=1+1", count: 3 }], cols);
    expect(out).toContain(`"'\t=1+1"`);
  });

  it("escapes a leading '+' and '-'", () => {
    const plus = buildCsvRow({ name: "+evil()", count: 0 }, cols);
    expect(plus).toContain(`"'\t+evil()"`);
    const dash = buildCsvRow({ name: "-cmd", count: 0 }, cols);
    expect(dash).toContain(`"'\t-cmd"`);
  });

  it("escapes a leading '@' (Excel WEBSERVICE)", () => {
    const row = buildCsvRow({ name: "@SUM(A1)", count: 0 }, cols);
    expect(row).toContain(`"'\t@SUM(A1)"`);
  });

  it("doubles embedded double-quotes", () => {
    const row = buildCsvRow({ name: `he said "hi"`, count: 1 }, cols);
    expect(row).toBe(`"he said ""hi""",1`);
  });

  it("emits numbers without quoting", () => {
    const row = buildCsvRow({ name: "ok", count: 42 }, cols);
    expect(row).toBe(`"ok",42`);
  });

  it("renders header without injection protection (header is trusted)", () => {
    const header = buildCsvHeader(cols);
    expect(header).toBe("name,count");
  });

  it("handles null and undefined as empty quoted strings", () => {
    const row = buildCsvRow(
      { name: null as unknown as string, count: undefined as unknown as number },
      cols,
    );
    expect(row).toBe(`"",""`);
  });
});

describe("parseProxyCsv", () => {
  it("parses colon-separated host:port", () => {
    const rows = parseProxyCsv("1.2.3.4:8080");
    expect(rows).toHaveLength(1);
    expect(rows[0].host).toBe("1.2.3.4");
    expect(rows[0].port).toBe(8080);
    expect(rows[0].error).toBeUndefined();
  });

  it("parses host:port:user:pass", () => {
    const rows = parseProxyCsv("1.2.3.4:8080:user:pass");
    expect(rows[0].username).toBe("user");
    expect(rows[0].password).toBe("pass");
  });

  it("parses comma-delimited", () => {
    const rows = parseProxyCsv("1.2.3.4,8080,u,p");
    expect(rows[0]).toMatchObject({
      host: "1.2.3.4",
      port: 8080,
      username: "u",
      password: "p",
    });
  });

  it("parses tab-delimited", () => {
    const rows = parseProxyCsv("1.2.3.4\t8080\tu\tp");
    expect(rows[0]).toMatchObject({ host: "1.2.3.4", port: 8080 });
  });

  it("skips blank lines", () => {
    const rows = parseProxyCsv("\n1.2.3.4:8080\n\n");
    expect(rows).toHaveLength(1);
  });

  it("skips header row when first line starts with 'host'", () => {
    const rows = parseProxyCsv("host,port\n1.2.3.4,8080");
    expect(rows).toHaveLength(1);
  });

  it("reports missing host", () => {
    const rows = parseProxyCsv(":8080");
    expect(rows[0].error).toBe("Missing host");
  });

  it("reports missing port", () => {
    const rows = parseProxyCsv("1.2.3.4:");
    expect(rows[0].error).toBe("Missing port");
  });

  it("reports invalid port range", () => {
    expect(parseProxyCsv("1.2.3.4:70000")[0].error).toMatch(/Invalid port/);
    expect(parseProxyCsv("1.2.3.4:0")[0].error).toMatch(/Invalid port/);
    expect(parseProxyCsv("1.2.3.4:abc")[0].error).toMatch(/Invalid port/);
  });

  it("tracks line numbers (1-based)", () => {
    const rows = parseProxyCsv("1.2.3.4:8080\n5.6.7.8:9090");
    expect(rows[0].line).toBe(1);
    expect(rows[1].line).toBe(2);
  });
});

describe("maskSecret", () => {
  it("masks a long value keeping prefix/suffix", () => {
    expect(maskSecret("supersecret")).toBe("su****et");
  });

  it("returns **** for short values", () => {
    expect(maskSecret("abcd")).toBe("****");
    expect(maskSecret("ab")).toBe("****");
  });

  it("returns empty for empty input", () => {
    expect(maskSecret("")).toBe("");
  });
});
