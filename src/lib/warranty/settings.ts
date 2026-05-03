/**
 * Wave 26-D — fetch the 5 warranty settings keys from `settings`
 * table and shape them as a typed object.
 *
 * Mirrors the loadGlobalCaps pattern in
 * src/lib/telegram/rate-limit.ts so admins tune warranty thresholds
 * via /settings without redeploy.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  DEFAULT_WARRANTY_SETTINGS,
  type WarrantySettings,
} from "./eligibility";

const WARRANTY_SETTINGS_KEYS = [
  "warranty_eligibility_unlimited",
  "warranty_max_pending",
  "warranty_max_per_30d",
  "warranty_cooldown_minutes",
  "warranty_reliability_decrement",
] as const;

export interface WarrantySettingsFull extends WarrantySettings {
  /** A7-bonus — points to subtract from proxy.reliability_score per approve. */
  reliability_decrement: number;
}

export const DEFAULT_WARRANTY_SETTINGS_FULL: WarrantySettingsFull = {
  ...DEFAULT_WARRANTY_SETTINGS,
  reliability_decrement: 25,
};

/**
 * Read the 5 warranty settings rows. Falls back to DEFAULT for any
 * missing/malformed key — graceful when migration hasn't been applied
 * yet (e.g. local dev) or admin manually deleted a row.
 */
export async function loadWarrantySettings(): Promise<WarrantySettingsFull> {
  const { data: rows } = await supabaseAdmin
    .from("settings")
    .select("key, value")
    .in("key", WARRANTY_SETTINGS_KEYS as unknown as string[]);

  const out: WarrantySettingsFull = { ...DEFAULT_WARRANTY_SETTINGS_FULL };

  if (!rows) return out;

  for (const r of rows) {
    const v = (r.value as { value: unknown } | null)?.value;
    switch (r.key) {
      case "warranty_eligibility_unlimited":
        if (typeof v === "boolean") out.eligibility_unlimited = v;
        break;
      case "warranty_max_pending":
        if (typeof v === "number" && v > 0) out.max_pending = Math.floor(v);
        break;
      case "warranty_max_per_30d":
        if (typeof v === "number" && v > 0) out.max_per_30d = Math.floor(v);
        break;
      case "warranty_cooldown_minutes":
        if (typeof v === "number" && v >= 0) out.cooldown_minutes = Math.floor(v);
        break;
      case "warranty_reliability_decrement":
        if (typeof v === "number" && v >= 0 && v <= 100)
          out.reliability_decrement = Math.floor(v);
        break;
    }
  }
  return out;
}
