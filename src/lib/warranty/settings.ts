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
      // Wave 26-D bug hunt [HIGH-3, security H4] — upper bounds. Pre-fix
      // an admin could set max_pending=999999 → effectively no anti-abuse;
      // or cooldown_minutes=99999 → permanent ban for the user. Now
      // each setting clamps to a sane range; out-of-range values fall
      // back to DEFAULT silently (logged elsewhere if needed).
      case "warranty_max_pending":
        // 1-20 — beyond 20 there's no realistic admin workflow that
        // benefits, and disabling (max=0) breaks the bot entirely.
        if (typeof v === "number" && v >= 1 && v <= 20)
          out.max_pending = Math.floor(v);
        break;
      case "warranty_max_per_30d":
        // 1-100 — beyond 100 in a 30d window is abuse, not legit.
        if (typeof v === "number" && v >= 1 && v <= 100)
          out.max_per_30d = Math.floor(v);
        break;
      case "warranty_cooldown_minutes":
        // 0 (disabled) up to 1440 (24h max) — beyond 24h is effectively
        // permanent block, which is a settings bug not a feature.
        if (typeof v === "number" && v >= 0 && v <= 1440)
          out.cooldown_minutes = Math.floor(v);
        break;
      case "warranty_reliability_decrement":
        // 0-100 (matches reliability_score range constraint mig 058).
        if (typeof v === "number" && v >= 0 && v <= 100)
          out.reliability_decrement = Math.floor(v);
        break;
    }
  }
  return out;
}
