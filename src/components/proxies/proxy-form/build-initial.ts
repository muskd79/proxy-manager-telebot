/**
 * Wave 26-D-pre2/G — buildInitialFormData extracted from proxy-form.tsx.
 *
 * Wave 26-B (gap 1.1) bug pin: pre-fix the inline initializer ran ONCE
 * on mount, so admins editing proxy A → closing → editing proxy B saw
 * A's data prefilled. Now both the initial useState() AND the prop-
 * change useEffect call this function.
 *
 * Pure function, vitest-friendly. Type-tested via the inferred return
 * shape (which the form's local FormState type narrows to).
 */

import type { Proxy } from "@/types/database";
import type { NetworkType } from "@/lib/proxy-labels";
import type { ProxyTypeValue } from "./schema";

export interface ProxyFormInitialData {
  host: string;
  port: string;
  type: ProxyTypeValue;
  network_type: NetworkType | "";
  username: string;
  password: string;
  country: string;
  city: string;
  category_id: string;
  notes: string;
  expires_at: string;
  purchase_date: string;
  vendor_source: string;
  purchase_price_usd: string;
  sale_price_usd: string;
}

export function buildInitialFormData(
  proxy: Proxy | null | undefined,
): ProxyFormInitialData {
  return {
    host: proxy?.host || "",
    port: proxy?.port?.toString() || "",
    type: (proxy?.type as ProxyTypeValue) || "http",
    network_type: (proxy?.network_type ?? "") as NetworkType | "",
    username: proxy?.username || "",
    password: proxy?.password || "",
    country: proxy?.country || "",
    city: proxy?.city || "",
    category_id: proxy?.category_id || "",
    notes: proxy?.notes || "",
    expires_at: proxy?.expires_at
      ? new Date(proxy.expires_at).toISOString().split("T")[0]
      : "",
    // Wave 26-B (gap 1.3) — purchase metadata pre-fill for edit mode.
    // The Proxy interface uses `vendor_label` + `cost_usd` (DB column
    // names); the form / API use `vendor_source` + `purchase_price_usd`
    // as the request-body names (same convention as ProxyImport).
    purchase_date: proxy?.purchase_date ? proxy.purchase_date.slice(0, 10) : "",
    vendor_source: proxy?.vendor_label ?? "",
    purchase_price_usd:
      proxy?.cost_usd != null ? String(proxy.cost_usd) : "",
    sale_price_usd:
      proxy?.sale_price_usd != null ? String(proxy.sale_price_usd) : "",
  };
}
