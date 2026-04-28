import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Activity log writer — the ONLY way to insert into activity_logs.
 *
 * Wave 22D unification: previously two parallel write paths existed —
 * this one (sanitised, capped) and `lib/telegram/logging.ts:logActivity`
 * (raw insert, NO sanitisation, NO cap). The Telegram path was used by
 * the bot for user-supplied data like Telegram usernames and was
 * exploitable: a username `"\nERROR actor_type=admin"` would forge a
 * second structured row in any log scraper that splits on `\n`, and a
 * GB-sized JSON blob would land in the DB unbounded.
 *
 * As of Wave 22D, the Telegram helper delegates here (see
 * `src/lib/telegram/logging.ts`). All inserts go through the same
 * sanitiser and the same per-string 1024 char cap.
 */

interface LogActivityParams {
  actorType: "admin" | "tele_user" | "system" | "bot";
  actorId?: string;
  /**
   * Wave 22D: human-readable actor label captured at insert time.
   * Stored in `activity_logs.actor_display_name` (mig 032). The
   * /logs UI prefers this over the truncated UUID. Point-in-time
   * snapshot — a later admin rename does NOT rewrite history.
   */
  actorDisplayName?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Recursively sanitize every string value in a value tree. Strips CR/LF/TAB
 * so an admin-supplied field like `display_name = "\nERROR: fake-amount=999"`
 * cannot forge a new structured log line in Vercel's log drain.
 * Also caps strings at 1024 chars to bound log-row size.
 */
function sanitizeLogValue<T>(v: T): T {
  if (typeof v === "string") {
    return v.replace(/[\r\n\t]/g, " ").slice(0, 1024) as unknown as T;
  }
  if (Array.isArray(v)) {
    return v.map((x) => sanitizeLogValue(x)) as unknown as T;
  }
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = sanitizeLogValue(val);
    }
    return out as unknown as T;
  }
  return v;
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  // Sanitize every free-text value before it hits the DB. The `action` and
  // `resourceType` columns are enum-like and controlled server-side, so they
  // don't need sanitizing; `details`, `ipAddress`, `userAgent`,
  // `actorDisplayName` come from request headers or admin/user input and
  // MUST be scrubbed.
  const details = params.details ? sanitizeLogValue(params.details) : null;
  const ipAddress = params.ipAddress ? sanitizeLogValue(params.ipAddress) : null;
  const userAgent = params.userAgent ? sanitizeLogValue(params.userAgent) : null;
  const actorDisplayName = params.actorDisplayName
    ? sanitizeLogValue(params.actorDisplayName)
    : null;

  const { error } = await supabaseAdmin.from("activity_logs").insert({
    actor_type: params.actorType,
    actor_id: params.actorId ?? null,
    actor_display_name: actorDisplayName,
    action: params.action,
    resource_type: params.resourceType ?? null,
    resource_id: params.resourceId ?? null,
    details,
    ip_address: ipAddress,
    user_agent: userAgent,
  });

  if (error) {
    console.error("Failed to log activity:", error.message);
  }
}
