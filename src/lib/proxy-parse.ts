/**
 * Wave 23B-fix — extracted from `proxy-import.tsx`. Pure function so
 * vitest can exercise it without mounting React. Cited as the highest
 * priority unit-test target by the test-coverage agent.
 *
 * Format accepted (one per line):
 *   host:port
 *   host:port:user:pass
 * Separator: `:`, tab, comma, semicolon (regex `[:\t,;]`).
 */

export interface ParsedProxyLine {
  /** 1-indexed line number from the source paste/file. */
  line: number;
  /** Raw source line as provided (trimmed). */
  raw: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  valid: boolean;
  /** Human-readable failure cause when valid=false. */
  error?: string;
}

const SEPARATOR_RE = /[:\t,;]/;

export function parseProxyLine(line: string, lineNum: number): ParsedProxyLine {
  const trimmed = line.trim();
  if (!trimmed) {
    return {
      line: lineNum,
      raw: line,
      host: "",
      port: 0,
      valid: false,
      error: "Empty line",
    };
  }
  const parts = trimmed.split(SEPARATOR_RE);
  if (parts.length < 2) {
    return {
      line: lineNum,
      raw: trimmed,
      host: "",
      port: 0,
      valid: false,
      error: "Invalid format (expected host:port)",
    };
  }
  const host = parts[0].trim();
  const port = parseInt(parts[1].trim(), 10);
  const username = parts[2]?.trim() || undefined;
  const password = parts[3]?.trim() || undefined;
  if (!host) {
    return {
      line: lineNum,
      raw: trimmed,
      host: "",
      port: 0,
      valid: false,
      error: "Missing host",
    };
  }
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    return {
      line: lineNum,
      raw: trimmed,
      host,
      port: 0,
      valid: false,
      error: "Invalid port",
    };
  }
  return {
    line: lineNum,
    raw: trimmed,
    host,
    port,
    username,
    password,
    valid: true,
  };
}

/**
 * Wave 23B — convenience wrapper for the textarea / file-drop flow.
 * Splits multi-line input on \n or \r\n and skips fully-empty lines
 * (counterpart of what proxy-import.tsx does with `.split(/\r?\n/).filter`).
 */
export function parseProxyText(content: string): ParsedProxyLine[] {
  return content
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((line, i) => parseProxyLine(line, i + 1));
}

/**
 * Wave 26-A → 26-C — pure dedupe helper. Walks a parsed batch and
 * flags duplicate `host:port` rows AFTER the first occurrence as
 * invalid with a message pointing at the original line number.
 *
 * Pre-fix the dedupe lived inside ProxyImport's parseContent
 * closure — couldn't unit-test, no regression coverage. Now it's
 * a stable utility shared between the wizard and any future
 * server-side import path that needs the same check.
 *
 * Returns a NEW array; input is not mutated. Order preserved so
 * the caller can keep their (line-number-keyed) UI rendering
 * unchanged.
 */
export function dedupeByHostPort<T extends ParsedProxyLine>(rows: T[]): T[] {
  const seen = new Map<string, number>(); // host:port → first line number
  return rows.map((p) => {
    if (!p.valid) return p;
    const key = `${p.host}:${p.port}`;
    const firstLine = seen.get(key);
    if (firstLine !== undefined) {
      return {
        ...p,
        valid: false,
        error: `Trùng dòng ${firstLine} (${key})`,
      };
    }
    seen.set(key, p.line);
    return p;
  });
}
