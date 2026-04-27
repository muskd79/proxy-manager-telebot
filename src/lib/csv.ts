/**
 * CSV utilities: safe export builder + import parser.
 *
 * Export cells are sanitized against OWASP formula-injection vectors so a
 * downloaded report cannot execute arbitrary spreadsheet formulas. Import
 * parsing accepts comma- or tab-delimited input and produces structured rows
 * with per-row validation errors instead of throwing.
 */

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/** Sanitize a cell value against CSV formula injection. */
function sanitizeCell(value: string): string {
  const escaped = value.replace(/"/g, '""');
  if (/^[=+\-@\t\r\n|\\]/.test(escaped)) {
    return `"'\t${escaped}"`;
  }
  return `"${escaped}"`;
}

export interface CsvColumn<T> {
  header: string;
  /** Returns the cell value. Numbers pass through as-is; strings are sanitized. */
  value: (row: T) => string | number | null | undefined;
}

/** Build a CSV string from rows and column definitions. */
export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = buildCsvHeader(columns);
  const lines = rows.map((row) => buildCsvRow(row, columns));
  return [header, ...lines].join("\n");
}

export function buildCsvHeader<T>(columns: CsvColumn<T>[]): string {
  return columns.map((c) => c.header).join(",");
}

export function buildCsvRow<T>(row: T, columns: CsvColumn<T>[]): string {
  return columns
    .map((c) => {
      const v = c.value(row);
      if (v === null || v === undefined) return '""';
      if (typeof v === "number") return String(v);
      return sanitizeCell(String(v));
    })
    .join(",");
}

// ---------------------------------------------------------------------------
// Parser (proxy import — host:port:user:pass / host,port,user,pass)
// ---------------------------------------------------------------------------

export interface ParsedProxyRow {
  host: string;
  port: number;
  username?: string;
  password?: string;
  /**
   * Vendor-supplied country (5th column when present in CSV).
   * Wave 22E-2 BUG FIX (B7): pre-fix parser ignored this field and
   * the import wizard overwrote whatever was in CSV with our GeoIP
   * heuristic. Now: if vendor provides country, it wins; GeoIP only
   * fills in the gap.
   */
  country?: string;
  line: number;
  raw: string;
  error?: string;
}

/** Simple heuristic: file starts with a header row if first field is non-numeric host-like. */
const HEADER_ROW_REGEX = /^host\b/i;

/**
 * Parse text into proxy rows. Supports three delimiters: `:`, `,`, and tab.
 * Each line may be `host:port`, `host:port:user:pass`, or comma/tab variants.
 * Invalid rows are returned with a non-empty `error` field instead of thrown.
 */
export function parseProxyCsv(text: string): ParsedProxyRow[] {
  const lines = text.split(/\r?\n/);
  const rows: ParsedProxyRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    if (i === 0 && HEADER_ROW_REGEX.test(raw)) continue;

    const delimiter = raw.includes("\t")
      ? "\t"
      : raw.includes(",")
        ? ","
        : ":";
    const parts = raw.split(delimiter).map((p) => p.trim());

    const host = parts[0] ?? "";
    const portStr = parts[1] ?? "";
    const username = parts[2] || undefined;
    const password = parts[3] || undefined;
    // Wave 22E-2: optional 5th column captures vendor's country label.
    // Common vendor formats: host:port:user:pass:country (Proxy-Seller),
    // host,port,user,pass,country (CSV exports).
    const countryRaw = parts[4]?.trim();
    const country = countryRaw && countryRaw.length <= 100 ? countryRaw : undefined;

    const row: ParsedProxyRow = {
      host,
      port: 0,
      username,
      password,
      country,
      line: i + 1,
      raw,
    };

    if (!host) {
      row.error = "Missing host";
      rows.push(row);
      continue;
    }
    if (host.length > 253) {
      row.error = "Host too long";
      rows.push(row);
      continue;
    }
    if (!portStr) {
      row.error = "Missing port";
      rows.push(row);
      continue;
    }
    const port = parseInt(portStr, 10);
    if (isNaN(port) || port < 1 || port > 65535 || String(port) !== portStr) {
      row.error = "Invalid port (1-65535)";
      rows.push(row);
      continue;
    }
    row.port = port;
    rows.push(row);
  }

  return rows;
}

/** Mask sensitive data for preview display (never log raw creds). */
export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "****";
  return value.slice(0, 2) + "****" + value.slice(-2);
}
