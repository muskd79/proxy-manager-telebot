import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { detectProxy } from "@/lib/proxy-detect";
import { parseProxyText } from "@/lib/proxy-parse";
import { getUserLanguage } from "../user";
import { logChatMessage } from "../logging";
import { denyIfNotApproved } from "../guards";
import { setBotState, clearBotState } from "../state";
import { CB } from "../callbacks";
import { ChatDirection, MessageType } from "@/types/database";

/**
 * Wave 24-checkproxy — redesign per user feedback 2026-05-02:
 *
 *   "kiểm tra proxy phải đúng với nhiệm vụ của nó, là khi bấm
 *    kiểm tra proxy thì người dùng sẽ dán danh sách proxy vào…"
 *
 * Pre-fix /checkproxy live-tested the user's OWN assigned proxies
 * — but /myproxies already shows those, and the live test for
 * personal proxies is rarely useful. The intent is:
 *
 *   /checkproxy lets the user paste ARBITRARY proxies (1-20) and
 *   the bot reports for each: alive/dead, latency, detected type.
 *
 * State machine: idle → awaiting_check_list → idle. The user's
 * next plain-text message is consumed by handleCheckListInput
 * (registered in handlers.ts message:text).
 */

const MAX_CHECK_PER_BATCH = 20;
/** Probe at most this many proxies in parallel. detectProxy fires
 * 3 sockets per host, so 5×3 = 15 sockets in flight — safe on
 * Vercel hobby + courteous to the targets. */
const PROBE_CONCURRENCY = 5;
/** Wave 25-pre1 (P0 4.4) — wall-clock budget for the whole batch.
 * 20 unreachable proxies × 5s detect timeout / 5 concurrent ≈ 20s.
 * Vercel hobby caps at 10s but Pro is 60s. We cap at 25s so we
 * stay within Pro's window with margin. Rest reports as "timeout". */
const BATCH_WALL_CLOCK_MS = 25_000;

export async function handleCheckProxy(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("id, language, status")
    .eq("telegram_id", from.id)
    .single();

  if (!user) return;
  const lang = getUserLanguage(user);

  if (await denyIfNotApproved(ctx, user, lang)) return;

  // Set state so the user's next text message is treated as the
  // proxy list to check (not as /support fallback or /help hint).
  await setBotState(user.id, { step: "awaiting_check_list" });

  const text = lang === "vi"
    ? [
        "*Kiểm tra proxy*",
        "",
        `Dán danh sách proxy bạn cần kiểm tra (tối đa *${MAX_CHECK_PER_BATCH}* proxy/lần):`,
        "",
        "Mỗi dòng 1 proxy theo dạng:",
        "  `host:port`",
        "  `host:port:user:pass`",
        "",
        "Bot sẽ kiểm tra: *trạng thái sống/chết*, *độ trễ (ms)*, *loại giao thức* (HTTP / HTTPS / SOCKS5).",
      ].join("\n")
    : [
        "*Check proxies*",
        "",
        `Paste the proxy list you want to check (up to *${MAX_CHECK_PER_BATCH}* per call):`,
        "",
        "One proxy per line:",
        "  `host:port`",
        "  `host:port:user:pass`",
        "",
        "Bot reports: *alive/dead*, *latency (ms)*, *protocol type* (HTTP / HTTPS / SOCKS5).",
      ].join("\n");

  const cancelKb = new InlineKeyboard()
    .text(lang === "vi" ? "Hủy" : "Cancel", CB.checkCancel());

  await ctx.reply(text, { parse_mode: "Markdown", reply_markup: cancelKb });
  await logChatMessage(
    user.id,
    ctx.message?.message_id ?? null,
    ChatDirection.Incoming,
    "/checkproxy",
    MessageType.Command,
  );
}

/**
 * Wave 24-checkproxy — consume the user's pasted proxy list.
 * Returns true when handled, false when state isn't ours.
 */
export async function handleCheckListInput(
  ctx: Context,
  text: string,
): Promise<boolean> {
  if (!ctx.from) return false;

  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("id, language")
    .eq("telegram_id", ctx.from.id)
    .single();
  if (!user) return false;
  const lang = getUserLanguage(user);

  await logChatMessage(
    user.id,
    null,
    ChatDirection.Incoming,
    `check_list:${text.length}_chars`,
    MessageType.Text,
  );

  const rows = parseProxyText(text);
  const valid = rows.filter((r) => r.valid);
  const invalid = rows.length - valid.length;

  if (valid.length === 0) {
    // Wave 25-pre2 (Pass 3.3) — bad-paste recovery. Pre-fix we kept
    // the user in awaiting_check_list state, so a retry that was
    // also bad showed the same message in a loop with no way out.
    // Clear state and tell them to /checkproxy again — fresh start.
    await clearBotState(user.id);
    await ctx.reply(
      lang === "vi"
        ? "[!] Không tìm thấy proxy hợp lệ. Mỗi dòng phải là `host:port` hoặc `host:port:user:pass`.\n\nBấm /checkproxy để thử lại."
        : "[!] No valid proxies found. Each line must be `host:port` or `host:port:user:pass`.\n\nUse /checkproxy to try again.",
      { parse_mode: "Markdown" },
    );
    return true;
  }

  if (valid.length > MAX_CHECK_PER_BATCH) {
    // Wave 25-pre2 (Pass 3.3) — same recovery: clear state + retry.
    await clearBotState(user.id);
    await ctx.reply(
      lang === "vi"
        ? `[!] Tối đa *${MAX_CHECK_PER_BATCH}* proxy/lần. Bạn vừa dán ${valid.length} dòng — vui lòng cắt bớt rồi /checkproxy lại.`
        : `[!] Maximum *${MAX_CHECK_PER_BATCH}* proxies per call. You sent ${valid.length} — please trim then /checkproxy again.`,
      { parse_mode: "Markdown" },
    );
    return true;
  }

  await clearBotState(user.id);

  // Acknowledge so the user knows we accepted the input. detectProxy
  // takes up to 5s/host; even with concurrency=5 a 20-proxy batch
  // can take ~20s, so user-facing feedback up front matters.
  await ctx.reply(
    lang === "vi"
      ? `Đang kiểm tra *${valid.length}* proxy${invalid > 0 ? ` (bỏ ${invalid} dòng lỗi)` : ""}...`
      : `Checking *${valid.length}* proxies${invalid > 0 ? ` (skipped ${invalid} bad lines)` : ""}...`,
    { parse_mode: "Markdown" },
  );

  // Probe with concurrency cap. detectProxy already tolerates
  // SSRF + timeout internally so we don't try/catch each.
  // Wave 25-pre1: track wall-clock budget so we never blow past
  // Vercel function timeout. Anything we run out of time on is
  // reported as "kiểm tra timeout".
  type ProbeRow = {
    line: number;
    host: string;
    port: number;
    alive: boolean;
    type: string | null;
    latency_ms: number;
    blocked?: boolean;
    timed_out?: boolean;
  };
  const results: ProbeRow[] = [];
  const probeStart = Date.now();

  for (let i = 0; i < valid.length; i += PROBE_CONCURRENCY) {
    const elapsed = Date.now() - probeStart;
    if (elapsed >= BATCH_WALL_CLOCK_MS) {
      // Mark remaining rows as timed_out and stop dialing.
      for (const row of valid.slice(i)) {
        results.push({
          line: row.line,
          host: row.host,
          port: row.port,
          alive: false,
          type: null,
          latency_ms: 0,
          timed_out: true,
        });
      }
      break;
    }
    const chunk = valid.slice(i, i + PROBE_CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (row) => {
        const r = await detectProxy(row.host, row.port);
        return {
          line: row.line,
          host: row.host,
          port: row.port,
          alive: r.alive,
          type: r.type,
          latency_ms: r.speed_ms,
          blocked: r.ssrf_blocked,
        } satisfies ProbeRow;
      }),
    );
    results.push(...chunkResults);
  }

  // Build the report. One line per proxy, plus a summary footer.
  const aliveCount = results.filter((r) => r.alive).length;
  const deadCount = results.length - aliveCount;

  const formatLine = (r: (typeof results)[number]): string => {
    const target = `\`${r.host}:${r.port}\``;
    if (r.blocked) {
      return `${target} — [!] ${lang === "vi" ? "IP bị chặn" : "blocked"}`;
    }
    if (r.timed_out) {
      return `${target} — [-] ${lang === "vi" ? "kiểm tra timeout" : "check timed out"}`;
    }
    if (r.alive) {
      const t = r.type ? r.type.toUpperCase() : "?";
      return `${target} — [OK] ${t} · ${r.latency_ms}ms`;
    }
    return `${target} — [X] ${lang === "vi" ? "không phản hồi" : "unreachable"}`;
  };

  const header = lang === "vi"
    ? `*Kết quả kiểm tra* (${aliveCount}/${results.length} sống, ${deadCount} chết)`
    : `*Check results* (${aliveCount}/${results.length} alive, ${deadCount} dead)`;

  const body = results.map(formatLine).join("\n");
  const footer = lang === "vi"
    ? "\n\n_Loại giao thức tự động phát hiện qua handshake. Kết quả TCP có thể khác client thật khi proxy yêu cầu auth._"
    : "\n\n_Protocol detected via handshake. TCP-level result may differ from a real client when the proxy requires auth._";

  await ctx.reply(`${header}\n\n${body}${footer}`, { parse_mode: "Markdown" });
  return true;
}
