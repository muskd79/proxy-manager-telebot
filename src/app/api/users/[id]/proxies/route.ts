import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ApiResponse } from "@/types/api";
import type { Proxy } from "@/types/database";
import { requireAnyRole } from "@/lib/auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { admin, error: authError } = await requireAnyRole(supabase);
    if (authError) return authError;

    // Wave 22D-3 SECURITY FIX: viewer role must NOT see proxy
    // username/password. The sibling route /api/proxies/[id] already
    // strips credentials for viewers (Wave 17); this route was missed
    // and `select("*")` was leaking creds to anyone with viewer role.
    // Mirror the pattern: fetch full row, strip creds in-app for
    // viewers. (Runtime column projection breaks Supabase JS's typed
    // overloads — strip post-fetch instead.)
    const isViewer = admin.role === "viewer";

    const { data, error } = await supabase
      .from("proxies")
      .select("*")
      .eq("assigned_to", id)
      .eq("is_deleted", false)
      .order("assigned_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message } satisfies ApiResponse<never>,
        { status: 500 }
      );
    }

    const rows = (data ?? []) as Proxy[];
    const sanitized = isViewer
      ? rows.map((p) => {
          // Strip credentials post-fetch. eslint-disable cosmetic
          // unused-var rule: we DO want to drop these fields.
          const { username: _u, password: _pw, ...rest } = p;
          return rest as Proxy;
        })
      : rows;

    return NextResponse.json({
      success: true,
      data: sanitized,
    } satisfies ApiResponse<Proxy[]>);
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}
