import { supabaseAdmin } from "@/lib/supabase/admin";

interface LogActivityParams {
  actorType: "admin" | "tele_user" | "system" | "bot";
  actorId?: string;
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
  // don't need sanitizing; `details`, `ipAddress`, `userAgent` come from
  // request headers or admin input and MUST be scrubbed.
  const details = params.details ? sanitizeLogValue(params.details) : null;
  const ipAddress = params.ipAddress ? sanitizeLogValue(params.ipAddress) : null;
  const userAgent = params.userAgent ? sanitizeLogValue(params.userAgent) : null;

  const { error } = await supabaseAdmin.from("activity_logs").insert({
    actor_type: params.actorType,
    actor_id: params.actorId ?? null,
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
