import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TRASH_AUTO_CLEAN_DAYS } from "@/lib/constants";

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel Cron sends Authorization header)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

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

  return NextResponse.json({
    success: true,
    data: { deletedProxies, deletedUsers, deletedRequests, cutoffDate: cutoff },
  });
}
