/**
 * Vendor adapter registry.
 *
 * Maps a vendor's `adapter_key` (from the vendors DB row) to the concrete
 * adapter instance. Adding a new vendor is two steps:
 *   1. Write an adapter in `./adapters/<slug>.ts` extending `BaseAdapter`.
 *   2. Import + register it here.
 *
 * Keeping this as a static map (not a dynamic lookup) so a typo in
 * `adapter_key` fails fast at boot, not at purchase time.
 */

import type { VendorAdapter } from "./types";
import { WebshareAdapter } from "./adapters/webshare";
import { SmartproxyAdapter } from "./adapters/smartproxy";
import { IProyalAdapter } from "./adapters/iproyal";

export const VENDOR_REGISTRY: Readonly<Record<string, VendorAdapter>> = Object.freeze({
  webshare: new WebshareAdapter(),
  smartproxy: new SmartproxyAdapter(),
  iproyal: new IProyalAdapter(),
});

export function getAdapter(adapterKey: string): VendorAdapter {
  const adapter = VENDOR_REGISTRY[adapterKey];
  if (!adapter) {
    throw new Error(
      `No adapter registered for key "${adapterKey}". Registered: ${Object.keys(VENDOR_REGISTRY).join(", ")}`,
    );
  }
  return adapter;
}

/** List all available adapter keys — useful for seeding the vendors table. */
export function listAdapterKeys(): string[] {
  return Object.keys(VENDOR_REGISTRY);
}
