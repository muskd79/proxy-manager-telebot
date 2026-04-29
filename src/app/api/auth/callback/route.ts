import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Validate the `next` query parameter so an attacker cannot craft a link
 * like `/auth/callback?next=https://evil.com` to phish post-login users.
 * Allow only same-origin paths starting with a single `/` (no `//` and
 * no `\` — both are protocol-relative on different parsers).
 *
 * Wave 23A SECURITY FIX (audit C-1, Open Redirect).
 */
function safeNextPath(raw: string | null): string {
  const fallback = "/dashboard";
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";

      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
