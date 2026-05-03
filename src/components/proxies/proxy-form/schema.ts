/**
 * Wave 26-D-pre2/G — proxy-form schema extracted from the 718-line
 * proxy-form.tsx monolith.
 *
 * Schema lives in its own file so:
 *   - Other surfaces (e.g. bulk-edit dialog, future API client codegen)
 *     can import the same shape without pulling React + JSX.
 *   - Tests can pin schema rules without mounting the dialog.
 *   - The component file shrinks below 400 lines after Wave 26-D-pre2/H.
 */

import { z } from "zod";
import { NETWORK_TYPE_VALUES } from "@/lib/proxy-labels";

export const proxyTypeValues = ["http", "https", "socks5"] as const;
export type ProxyTypeValue = (typeof proxyTypeValues)[number];

export const proxySchema = z.object({
  host: z.string().min(1, "Bắt buộc nhập host"),
  port: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535, "Port phải nằm trong khoảng 1-65535"),
  type: z.enum(proxyTypeValues),
  // Wave 22J — phân loại proxy (không liên quan tới giao thức `type`).
  network_type: z.enum(NETWORK_TYPE_VALUES).optional().or(z.literal("")),
  username: z.string().optional(),
  password: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  // Wave 22Y — ISP field removed from UI (kept in DB for legacy imports).
  // Wave 23B — Danh mục phải chọn được khi thêm 1 proxy lẻ
  // (trước đây chỉ làm được qua bulk-assign — UX feedback từ user).
  category_id: z.string().optional().or(z.literal("")),
  notes: z.string().optional(),
  expires_at: z.string().optional(),
  // Wave 26-B (gap 1.3) — purchase metadata exposed for single-proxy
  // edit. Pre-fix: import wizard set these but Sửa form couldn't edit
  // them, forcing admins through bulk-edit even for 1-row tweaks.
  // String inputs: prices stay strings until submit, then converted.
  purchase_date: z.string().optional(),
  vendor_source: z.string().optional(),
  purchase_price_usd: z.string().optional(),
  sale_price_usd: z.string().optional(),
});

export type ProxyFormData = z.infer<typeof proxySchema>;
