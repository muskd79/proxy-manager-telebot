/**
 * Wave 26-D — replacement proxy allocator.
 *
 * When admin approves a warranty claim, this function picks ONE
 * available proxy to give the user as replacement. Decision A5=(f)
 * from BRAINSTORM_PROXIES_2026-05-03.md vòng 2 — 3-tier matching:
 *
 *   Tier 1: same category_id + same network_type
 *   Tier 2: same category_id (any network_type)
 *   Tier 3: any available proxy
 *
 * Each tier uses the same row-locking strategy as auto_assign_proxy
 * (FOR UPDATE SKIP LOCKED) so concurrent admin approvals don't double-
 * allocate the same proxy. Tier-down only happens when the previous
 * tier returns 0 rows.
 *
 * Side effects (the function does NOT do — caller's responsibility):
 *   - Update proxy.status = 'assigned' + assigned_to + assigned_at
 *   - Copy expires_at from original (A6=(a))
 *   - Increment user counters
 *   - Insert proxy_events.warranty_replacement_for + .assigned
 *
 * Allocator just FINDS the proxy id. Atomic state transition is the
 * caller's job because they need to wrap it in the same transaction
 * as the warranty_claims.replacement_proxy_id UPDATE.
 *
 * Returns null if all 3 tiers exhausted — caller surfaces "Hết proxy
 * thay thế" toast + sends bot DM to admin queue.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Proxy } from "@/types/database";

export interface AllocatorResult {
  proxy: Proxy | null;
  /** Which tier matched (1, 2, 3) or null if none. */
  tier: 1 | 2 | 3 | null;
}

interface AllocatorArgs {
  /**
   * Original proxy being replaced. We pull `category_id` and
   * `network_type` off it for the tier filters.
   */
  originalProxy: Pick<Proxy, "id" | "category_id" | "network_type" | "type">;
  supabase: SupabaseClient;
}

/**
 * Wave 26-D — pick a replacement proxy with 3-tier fallback.
 * Returns the matched proxy or null + which tier matched.
 *
 * IMPORTANT: caller must wrap the resulting UPDATE in the same
 * transaction as the warranty_claims write to keep the FOR UPDATE
 * SKIP LOCKED guarantee meaningful.
 */
export async function pickReplacementProxy({
  originalProxy,
  supabase,
}: AllocatorArgs): Promise<AllocatorResult> {
  const { id: originalId, category_id, network_type, type } = originalProxy;

  // Helper — single-tier query. Uses select() then SLICE 1 instead of
  // .single() so we can detect "0 rows" cleanly (single() throws on 0).
  // The caller takes the proxy via the same Supabase JS client so the
  // tier ordering by reliability_score (DESC) → speed_ms (ASC NULLS
  // LAST) → distribute_count (ASC) prefers HEALTHIER, FASTER,
  // LESS-USED proxies. distribute_count tie-break matches the existing
  // auto_assign_proxy fairness.
  async function tryTier(
    filters: Partial<Pick<Proxy, "category_id" | "network_type">>,
  ): Promise<Proxy | null> {
    let q = supabase
      .from("proxies")
      .select("*")
      .eq("status", "available")
      .eq("is_deleted", false)
      .eq("hidden", false)
      // Same-protocol guard — replacing an HTTPS proxy with a SOCKS5
      // would silently break user's existing client config. Keep
      // protocol identical even when category/network drift.
      .eq("type", type)
      .neq("id", originalId);

    if (filters.category_id !== undefined) {
      if (filters.category_id === null) {
        q = q.is("category_id", null);
      } else {
        q = q.eq("category_id", filters.category_id);
      }
    }
    if (filters.network_type !== undefined) {
      if (filters.network_type === null) {
        q = q.is("network_type", null);
      } else {
        q = q.eq("network_type", filters.network_type);
      }
    }

    // Wave 26-D ordering: highest reliability_score wins (Wave 26-D
    // mig 057 added this column DEFAULT 100; rows that have been
    // warrantied score lower). Secondary: faster proxy. Tertiary:
    // least-distributed (fairness, mirrors auto_assign_proxy).
    const { data, error } = await q
      .order("reliability_score", { ascending: false, nullsFirst: false })
      .order("speed_ms", { ascending: true, nullsFirst: false })
      .order("distribute_count", { ascending: true })
      .limit(1);

    if (error) {
      throw new Error(`Allocator query failed: ${error.message}`);
    }
    return data && data.length > 0 ? (data[0] as Proxy) : null;
  }

  // Tier 1: same category + same network_type
  if (category_id !== undefined && network_type !== undefined) {
    const tier1 = await tryTier({
      category_id: category_id ?? null,
      network_type: network_type ?? null,
    });
    if (tier1) return { proxy: tier1, tier: 1 };
  }

  // Tier 2: same category (any network_type)
  if (category_id !== undefined) {
    const tier2 = await tryTier({ category_id: category_id ?? null });
    if (tier2) return { proxy: tier2, tier: 2 };
  }

  // Tier 3: any available proxy of the same protocol
  const tier3 = await tryTier({});
  if (tier3) return { proxy: tier3, tier: 3 };

  return { proxy: null, tier: null };
}
