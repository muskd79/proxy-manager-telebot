import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TRASH_AUTO_CLEAN_DAYS } from "@/lib/constants";
import { verifyCronSecret } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - TRASH_AUTO_CLEAN_DAYS);
  const cutoff = cutoffDate.toISOString();

  let deletedProxies = 0, deletedUsers = 0, deletedRequests = 0;

  // Delete old trashed proxies
  const { count: pc } = await supabaseAdmin
    .from("proxies")
    .delete({ count: "exact" })
    .eq("is_deleted", true)
    .lt("deleted_at", cutoff);
  deletedProxies = pc ?? 0;

  // Delete old trashed users
  const { count: uc } = await supabaseAdmin
    .from("tele_users")
    .delete({ count: "exact" })
    .eq("is_deleted", true)
    .lt("deleted_at", cutoff);
  deletedUsers = uc ?? 0;

  // Delete old trashed requests
  const { count: rc } = await supabaseAdmin
    .from("proxy_requests")
    .delete({ count: "exact" })
    .eq("is_deleted", true)
    .lt("deleted_at", cutoff);
  deletedRequests = rc ?? 0;

  // Clean old activity logs (90 days)
  const logCutoff = new Date();
  logCutoff.setDate(logCutoff.getDate() - 90);
  const { count: logCount } = await supabaseAdmin
    .from("activity_logs")
    .delete({ count: "exact" })
    .lt("created_at", logCutoff.toISOString());
  const deletedLogs = logCount ?? 0;

  // Clean old chat messages (90 days)
  const chatCutoff = new Date();
  chatCutoff.setDate(chatCutoff.getDate() - 90);
  const { count: chatCount } = await supabaseAdmin
    .from("chat_messages")
    .delete({ count: "exact" })
    .lt("created_at", chatCutoff.toISOString());
  const deletedChats = chatCount ?? 0;

  return NextResponse.json({
    success: true,
    data: { deletedProxies, deletedUsers, deletedRequests, deletedLogs, deletedChats, cutoffDate: cutoff },
  });
}
