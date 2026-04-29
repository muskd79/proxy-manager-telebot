import { NextResponse } from "next/server";
import { openApiSpec } from "./openapi";
import { createClient } from "@/lib/supabase/server";
import { requireAnyRole } from "@/lib/auth";

/**
 * Wave 23A — gate the OpenAPI spec behind admin auth.
 * The spec lists every internal endpoint and is useful recon for
 * unauthenticated attackers. Admins still need it for development.
 */
export async function GET() {
  const supabase = await createClient();
  const { error: authError } = await requireAnyRole(supabase);
  if (authError) return authError;

  return NextResponse.json(openApiSpec);
}
