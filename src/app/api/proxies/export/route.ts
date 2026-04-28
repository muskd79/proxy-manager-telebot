import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAnyRole } from "@/lib/auth";
import { buildCsv, type CsvColumn } from "@/lib/csv";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  const format = request.nextUrl.searchParams.get("format") || "csv";
  const isViewer = admin.role === "viewer";

  // Fetch all proxies (paginated to avoid memory issues)
  const allProxies: Record<string, unknown>[] = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("proxies")
      .select("*")
      .eq("is_deleted", false)
      .range(page * pageSize, (page + 1) * pageSize - 1)
      .order("created_at", { ascending: false });

    if (error || !data || data.length === 0) break;

    for (const proxy of data) {
      if (isViewer) delete (proxy as Record<string, unknown>).password;
      allProxies.push(proxy as Record<string, unknown>);
    }

    if (data.length < pageSize) break;
    page++;
  }

  if (format === "json") {
    return new NextResponse(JSON.stringify(allProxies, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="proxies-${new Date().toISOString().split("T")[0]}.json"`,
      },
    });
  }

  // CSV format
  if (allProxies.length === 0) {
    return new NextResponse("No proxies found", { status: 404 });
  }

  // Wave 22D-6 SECURITY FIX: pre-22D-6 hand-rolled CSV serializer
  // failed to escape leading `=`, `+`, `-`, `@` — admins downloading
  // an export and opening it in Excel/Sheets would execute arbitrary
  // formulas (CSV injection / formula injection). buildCsv from
  // lib/csv.ts prepends a sanitising prefix to dangerous cells.
  const headerKeys = Object.keys(allProxies[0]);
  const columns: CsvColumn<Record<string, unknown>>[] = headerKeys.map((h) => ({
    header: h,
    value: (row) => {
      const v = row[h];
      if (v === null || v === undefined) return "";
      if (typeof v === "number") return v;
      return typeof v === "string" ? v : JSON.stringify(v);
    },
  }));
  const csv = buildCsv(allProxies, columns);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="proxies-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
