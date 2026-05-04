import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TRASH_AUTO_CLEAN_DAYS } from "@/lib/constants";
import { verifyCronSecret } from "@/lib/auth";
import { withCronLock } from "@/lib/cron/advisory-lock";
import { captureError } from "@/lib/error-tracking";

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const outcome = await withCronLock(supabaseAdmin, "cron.cleanup", runCleanup);
  if (outcome.skipped) {
    return NextResponse.json({ success: true, data: { skipped: true, reason: outcome.reason } });
  }
  return NextResponse.json({ success: true, data: outcome.result });
}

/**
 * Wave 26-D bug hunt v5 [debugger #6, MEDIUM] — every DELETE result
 * MUST surface its `error` via captureError. Pre-fix the route
 * destructured only `count` and discarded `error`; an FK violation
 * (e.g., `activity_logs` FK onto `proxies` without CASCADE) returned
 * `{ count: null, error: {...} }` and the cron silently logged
 * `deletedProxies: 0`. Old trash accumulated invisibly.
 *
 * Sequential (not Promise.all) — the test mock infrastructure shares
 * a global chainState that races under fan-out. Parallelization
 * (perf optimization) is deferred to PR #19 alongside a parallel-
 * safe mock refactor. The error-check is the real correctness fix
 * here.
 */
async function runCleanup() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - TRASH_AUTO_CLEAN_DAYS);
  const cutoff = cutoffDate.toISOString();

  const logCutoff = new Date();
  logCutoff.setDate(logCutoff.getDate() - 90);
  const logCutoffIso = logCutoff.toISOString();

  const chatCutoff = new Date();
  chatCutoff.setDate(chatCutoff.getDate() - 90);
  const chatCutoffIso = chatCutoff.toISOString();

  const proxiesRes = await supabaseAdmin
    .from("proxies")
    .delete({ count: "exact" })
    .eq("is_deleted", true)
    .lt("deleted_at", cutoff);
  if (proxiesRes.error) {
    captureError(proxiesRes.error, { source: "cron.cleanup.proxies" });
  }

  const usersRes = await supabaseAdmin
    .from("tele_users")
    .delete({ count: "exact" })
    .eq("is_deleted", true)
    .lt("deleted_at", cutoff);
  if (usersRes.error) {
    captureError(usersRes.error, { source: "cron.cleanup.tele_users" });
  }

  const requestsRes = await supabaseAdmin
    .from("proxy_requests")
    .delete({ count: "exact" })
    .eq("is_deleted", true)
    .lt("deleted_at", cutoff);
  if (requestsRes.error) {
    captureError(requestsRes.error, { source: "cron.cleanup.proxy_requests" });
  }

  const logsRes = await supabaseAdmin
    .from("activity_logs")
    .delete({ count: "exact" })
    .lt("created_at", logCutoffIso);
  if (logsRes.error) {
    captureError(logsRes.error, { source: "cron.cleanup.activity_logs" });
  }

  const chatsRes = await supabaseAdmin
    .from("chat_messages")
    .delete({ count: "exact" })
    .lt("created_at", chatCutoffIso);
  if (chatsRes.error) {
    captureError(chatsRes.error, { source: "cron.cleanup.chat_messages" });
  }

  return {
    deletedProxies: proxiesRes.count ?? 0,
    deletedUsers: usersRes.count ?? 0,
    deletedRequests: requestsRes.count ?? 0,
    deletedLogs: logsRes.count ?? 0,
    deletedChats: chatsRes.count ?? 0,
    cutoffDate: cutoff,
    // Surface error presence so the response makes silent failure
    // visible to anyone calling /api/cron/cleanup directly for debug.
    errors: {
      proxies: proxiesRes.error?.message ?? null,
      users: usersRes.error?.message ?? null,
      requests: requestsRes.error?.message ?? null,
      logs: logsRes.error?.message ?? null,
      chats: chatsRes.error?.message ?? null,
    },
  };
}
