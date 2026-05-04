/**
 * Wave 25-pre1 (P0 1.1, 3.1, 4.6) — Telegram Markdown escape.
 *
 * Telegram's "Markdown" parse_mode treats `*_[]()~\`>#+-=|{}.!` as
 * formatting characters. Any one of them inside a user-supplied
 * field (first_name, host, password, request reason…) turned into
 * a 400 "can't parse entities" from sendMessage and the user got
 * silence.
 *
 * We use the legacy "Markdown" parse_mode (not MarkdownV2) because
 * existing messages.ts copy uses single asterisks and backticks.
 * Legacy Markdown only requires escaping a smaller set:
 *   `*`, `_`, `[`, `` ` ``, `]`
 *
 * For richer payloads (bot.ts api.config.use → MarkdownV2) the
 * full V2 set is needed. Use `escapeMarkdownV2` then.
 */

const LEGACY_RE = /[*_[\]`]/g;

const V2_RE = /[_*[\]()~`>#+\-=|{}.!]/g;

/**
 * Escape characters that break Telegram's legacy Markdown parser.
 * Use when assembling messages with `parse_mode: "Markdown"`.
 */
export function escapeMarkdown(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  return String(input).replace(LEGACY_RE, (m) => `\\${m}`);
}

/**
 * Escape characters that break Telegram's MarkdownV2 parser.
 * Use only when sending with `parse_mode: "MarkdownV2"`.
 */
export function escapeMarkdownV2(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  return String(input).replace(V2_RE, (m) => `\\${m}`);
}

/**
 * Convenience: escape a host:port:user:pass triple for inline use
 * inside a backtick-fenced code block. We can't backtick-escape
 * inside legacy Markdown, so the safest path is to strip the few
 * backticks the user might have pasted.
 */
export function safeCredentialString(
  host: string,
  port: number,
  username?: string | null,
  password?: string | null,
): string {
  const cleanHost = String(host).replace(/`/g, "");
  const cleanUser = username ? String(username).replace(/`/g, "") : "";
  const cleanPass = password ? String(password).replace(/`/g, "") : "";
  if (cleanUser && cleanPass) {
    return `${cleanHost}:${port}:${cleanUser}:${cleanPass}`;
  }
  return `${cleanHost}:${port}`;
}

/**
 * Wave 26-D bug hunt v3 [HIGH] — strip backticks from a single
 * credential field (host / username / password) before it's
 * interpolated into a Telegram message template.
 *
 * The proxy-assigned templates wrap credentials in a backtick
 * code-span (`` `{host}:{port}:{user}:{pass}` ``). Inside a code-span
 * legacy Markdown leaves `*` `_` `[` `]` literal — only a stray
 * backtick can close the span early and expose the rest of the
 * message to Markdown parsing (or trigger a Telegram 400 silent
 * drop). This helper sanitises one field at a time so call sites
 * can use it inline with `fillTemplate`:
 *
 *   fillTemplate(msg.proxyAssigned[lang], {
 *     host: stripBackticks(proxy.host),
 *     username: stripBackticks(proxy.username ?? ""),
 *     password: stripBackticks(proxy.password ?? ""),
 *     ...
 *   })
 *
 * Pre-fix: an admin who created a proxy with a password containing
 * `` ` `` (rare but legal in HTTP proxy auth) would either crash
 * Telegram's parser (user gets nothing) or break the code-span and
 * let the trailing copy render as Markdown.
 */
export function stripBackticks(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  return String(input).replace(/`/g, "");
}
