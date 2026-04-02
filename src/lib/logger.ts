import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ActorType } from "@/types/database";

interface LogActivityParams {
  actorType: ActorType;
  actorId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  const { error } = await supabaseAdmin.from("activity_logs").insert({
    actor_type: params.actorType,
    actor_id: params.actorId ?? null,
    action: params.action,
    resource_type: params.resourceType ?? null,
    resource_id: params.resourceId ?? null,
    details: params.details ?? null,
    ip_address: params.ipAddress ?? null,
    user_agent: params.userAgent ?? null,
  });

  if (error) {
    console.error("Failed to log activity:", error.message);
  }
}
