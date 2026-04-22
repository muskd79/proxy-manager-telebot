/**
 * buildVendorCtx — resolve a vendor_id into a ready-to-use VendorCtx.
 *
 * Loads the vendor row, fetches the primary credential, and decrypts it via
 * the SECURITY DEFINER RPC. Returned ctx carries the plaintext API key; the
 * caller is responsible for not logging it and discarding the ctx as soon
 * as the vendor call returns.
 *
 * Throws VendorError with an actionable code if any step fails so API
 * routes can surface the right HTTP status without branching on string
 * messages.
 */

import type { VendorCtx } from "./types";
import { VendorError } from "./errors";
import { getAdapter } from "./registry";
import type { VendorAdapter } from "./types";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface ResolvedVendor {
  adapter: VendorAdapter;
  ctx: VendorCtx;
  vendor: {
    id: string;
    slug: string;
    display_name: string;
    status: "active" | "paused" | "deprecated";
  };
}

export async function buildVendorCtx(
  vendorId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ResolvedVendor> {
  const { data: vendor, error: vendorErr } = await supabaseAdmin
    .from("vendors")
    .select("id, slug, display_name, status, base_url, adapter_key")
    .eq("id", vendorId)
    .single();

  if (vendorErr || !vendor) {
    throw new VendorError("unknown", "not_found", "Vendor not found", 404);
  }
  if (vendor.status === "deprecated") {
    throw new VendorError(
      vendor.slug,
      "invalid_request",
      `Vendor ${vendor.slug} is deprecated and cannot be used`,
      400,
    );
  }

  const { data: credRow, error: credErr } = await supabaseAdmin
    .from("vendor_credentials")
    .select("id")
    .eq("vendor_id", vendor.id)
    .eq("is_primary", true)
    .is("revoked_at", null)
    .single();

  if (credErr || !credRow) {
    throw new VendorError(
      vendor.slug,
      "auth_failed",
      "No primary credential configured for this vendor",
      401,
    );
  }

  const { data: plaintext, error: decryptErr } = await supabaseAdmin.rpc(
    "decrypt_vendor_cred",
    { p_credential_id: credRow.id },
  );
  if (decryptErr || typeof plaintext !== "string") {
    throw new VendorError(
      vendor.slug,
      "auth_failed",
      "Failed to decrypt credential",
      500,
    );
  }

  const adapter = getAdapter(vendor.adapter_key);

  const ctx: VendorCtx = {
    apiKey: plaintext,
    baseUrl: vendor.base_url,
    supabase: supabaseAdmin,
    vendorId: vendor.id,
    signal: opts.signal,
  };

  return {
    adapter,
    ctx,
    vendor: {
      id: vendor.id,
      slug: vendor.slug,
      display_name: vendor.display_name,
      status: vendor.status as "active" | "paused" | "deprecated",
    },
  };
}
