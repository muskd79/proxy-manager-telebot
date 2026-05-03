/**
 * Wave 25-pre4 (Pass 2.1) — Telegram message-length splitter.
 *
 * Telegram's sendMessage caps each text payload at 4096 UTF-16 code
 * units. Past that the API returns 400 "MESSAGE_TOO_LONG" and the
 * user sees nothing. Pre-fix three commands could overflow:
 *   - /myproxies for a user with many assigned proxies (each line
 *     contains credentials, so 80 proxies × ~80 chars ≈ 6.4k)
 *   - /checkproxy results when 20 long URLs are pasted (header +
 *     20 lines of `host:port — ...` ≈ 4-5k easily)
 *   - bulk-proxy.ts inline path when 3 proxies have unusually long
 *     usernames/passwords
 *
 * `chunkMessage(text, max)` splits a long string on newline boundaries
 * (preferred for readability) and falls back to hard char-cutoff only
 * when a single line exceeds `max`. We default `max = 3800` to leave
 * ~300 char margin for envelope text the caller might prepend
 * (e.g. "Part 1/3 — "); 3800 is below the 4096 hard ceiling.
 *
 * Usage:
 *   for (const chunk of chunkMessage(longText)) {
 *     await ctx.reply(chunk, { parse_mode: "Markdown" });
 *   }
 *
 * Edge cases:
 *   - Input ≤ max → returns `[text]` unchanged.
 *   - Single line longer than max → that line gets char-cut into
 *     multiple chunks; rare but handled (no infinite loop).
 *   - Empty input → returns `[""]` (one empty chunk so caller can
 *     still call ctx.reply once if desired).
 */
const DEFAULT_MAX = 3800;

export function chunkMessage(text: string, max: number = DEFAULT_MAX): string[] {
  if (text.length <= max) return [text];

  const chunks: string[] = [];
  const lines = text.split("\n");
  let buf = "";

  const pushBuf = () => {
    if (buf.length > 0) {
      chunks.push(buf);
      buf = "";
    }
  };

  for (const line of lines) {
    // Single line bigger than budget — hard-cut. Rare in our use
    // cases (longest individual line is ~300 chars for a proxy
    // credential row) but safe to handle so the function is
    // total.
    if (line.length > max) {
      pushBuf();
      for (let i = 0; i < line.length; i += max) {
        chunks.push(line.slice(i, i + max));
      }
      continue;
    }

    // Would fit — append (with separating newline if buf is non-empty).
    const sepLen = buf.length > 0 ? 1 : 0;
    if (buf.length + sepLen + line.length > max) {
      pushBuf();
      buf = line;
    } else {
      buf = buf.length > 0 ? `${buf}\n${line}` : line;
    }
  }

  pushBuf();
  return chunks;
}
