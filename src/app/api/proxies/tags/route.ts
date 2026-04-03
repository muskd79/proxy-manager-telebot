import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAnyRole, requireAdminOrAbove } from "@/lib/auth";
import { TagActionSchema } from "@/lib/validations";

// GET: List all tags with counts
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  const { data: proxies } = await supabase
    .from("proxies")
    .select("tags")
    .eq("is_deleted", false)
    .not("tags", "is", null);

  const tagCounts = new Map<string, number>();
  for (const proxy of proxies || []) {
    if (Array.isArray(proxy.tags)) {
      for (const tag of proxy.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
  }

  const data = Array.from(tagCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({ success: true, data });
}

// PUT: Rename or delete tag across all proxies
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  const body = await request.json();
  const parsed = TagActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { action } = parsed.data;

  if (action === "rename") {
    const { from, to } = parsed.data;

    // Get all proxies with this tag
    const { data: proxies } = await supabase
      .from("proxies")
      .select("id, tags")
      .eq("is_deleted", false)
      .contains("tags", [from]);

    let updated = 0;
    for (const proxy of proxies || []) {
      const newTags = (proxy.tags as string[]).map(t => t === from ? to : t);
      // Remove duplicates
      const uniqueTags = [...new Set(newTags)];
      await supabase.from("proxies").update({ tags: uniqueTags }).eq("id", proxy.id);
      updated++;
    }

    return NextResponse.json({ success: true, data: { updated } });
  }

  if (action === "delete") {
    const { tag } = parsed.data;

    const { data: proxies } = await supabase
      .from("proxies")
      .select("id, tags")
      .eq("is_deleted", false)
      .contains("tags", [tag]);

    let updated = 0;
    for (const proxy of proxies || []) {
      const newTags = (proxy.tags as string[]).filter(t => t !== tag);
      await supabase.from("proxies").update({ tags: newTags.length > 0 ? newTags : null }).eq("id", proxy.id);
      updated++;
    }

    return NextResponse.json({ success: true, data: { updated } });
  }

  return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 });
}
