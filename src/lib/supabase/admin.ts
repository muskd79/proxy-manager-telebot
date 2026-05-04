import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS. NEVER import from client
 * components — the `server-only` marker above makes Next.js throw a build
 * error if this module lands in a browser bundle.
 *
 * Wave 27 bug hunt v6 [debugger #3, HIGH] — fail fast at module load
 * if env vars are missing.
 *
 * Pre-fix: `process.env.X || ""` fallback created a *valid* client
 * pointing at `https://` with an empty key. All requests then failed
 * with confusing `FetchError: invalid URL` runtime errors instead of
 * a clear startup error. Logs were noisy and the cause was hard to
 * trace.
 *
 * Now: throw at module-load. Next.js surfaces this at boot/build —
 * deploy fails immediately with a clear message naming the missing
 * variable. Tests can either set these in the test environment or
 * stub the module via `vi.mock("@/lib/supabase/admin", ...)`.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    `Missing Supabase admin env vars. Required: ` +
      `${!supabaseUrl ? "NEXT_PUBLIC_SUPABASE_URL " : ""}` +
      `${!supabaseServiceKey ? "SUPABASE_SERVICE_ROLE_KEY" : ""}`.trim(),
  );
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
