"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
// Wave 28 hotfix — explicit count + typed-confirm before mass-hiding
// every proxy in a category. Prevents the "mất hết proxy" accident
// reported in production.
import { DangerousConfirmDialog } from "@/components/shared/dangerous-confirm-dialog";
// Wave 28-E [P0] — sentinel "Mặc định" must not be renamable / hidden
// from the form. The DB triggers throw a 500 if you try; the API
// returns a friendly 403; the form should disable inputs upfront so
// admin doesn't even reach the API.
import { isDefaultCategory } from "@/lib/categories/constants";
import type { ProxyCategory } from "@/types/database";
import { Loader2, Save, AlertTriangle, Lock } from "lucide-react";
import {
  NETWORK_TYPE_VALUES,
  NETWORK_TYPE_LABEL,
  normalizeNetworkType,
  type NetworkType,
} from "@/lib/proxy-labels";

/**
 * Create / edit dialog for proxy_categories.
 *
 * Single component handles both modes:
 *   - When `category` is null  -> create flow, POST /api/categories
 *   - When `category` is set   -> edit flow, PATCH /api/categories/[id]
 *
 * Wave 28-C field set:
 *   name, description, color, default_purchase_price_usd,
 *   default_sale_price_usd, default_country, default_proxy_type,
 *   default_network_type, default_vendor_source, min_stock_alert.
 *   is_hidden exposed only in edit mode (typed-confirm gate from
 *   Wave 28 hotfix protects against accidental mass-hide).
 *
 * Removed in Wave 28-C (user feedback: "khả năng tao thấy không
 * cần phần này"):
 *   - sort_order input — DB column kept, default 0; future agent can
 *     resurrect via /categories card grid drag handle
 *   - icon picker — DB column kept, default "folder"; the 8 generic
 *     icons (globe, shield, zap, ...) didn't map to real proxy
 *     concepts and the user found them noise
 *
 * Replaced in Wave 28-C:
 *   - single "Giá mặc định" -> two fields "Giá mua ($)" + "Giá bán
 *     ($)" so admin can track purchase cost vs sale price separately
 *     (margin calculation downstream). Soft warning if sale < purchase
 *     but allows save (loss-leader / promotion case).
 */

const COLOR_PRESETS = [
  "purple",
  "blue",
  "green",
  "yellow",
  "red",
  "pink",
  "indigo",
  "gray",
] as const;

interface CategoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: ProxyCategory | null;
  onSaved: () => void;
}

export function CategoryFormDialog({
  open,
  onOpenChange,
  category,
  onSaved,
}: CategoryFormDialogProps) {
  const isEdit = category !== null;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string>("purple");
  // Wave 28-C — `icon` and `sortOrder` are DB-only now (no UI input).
  // Tracked here as constants so save() can still send them and
  // re-creating the form via category prop preserves the value.
  const [icon, setIcon] = useState<string>("folder");
  const [sortOrder, setSortOrder] = useState(0);
  // Wave 28-C — split "default_price" into purchase + sale prices.
  // Both are independently nullable (admin can set either, neither,
  // or both). `defaultPrice` legacy state kept for back-compat with
  // mig 059 snapshot trigger which still reads default_sale_price_usd.
  const [defaultPurchasePrice, setDefaultPurchasePrice] = useState("");
  const [defaultSalePrice, setDefaultSalePrice] = useState("");
  // Wave 22G — rich-category snapshot defaults.
  const [defaultCountry, setDefaultCountry] = useState("");
  const [defaultProxyType, setDefaultProxyType] = useState<string>("");
  const [defaultIsp, setDefaultIsp] = useState("");
  // Wave 28-C — vendor source (was missing from form pre-Wave-28-C).
  const [defaultVendorSource, setDefaultVendorSource] = useState("");
  // Wave 22J — proxy classification snapshot default.
  const [defaultNetworkType, setDefaultNetworkType] = useState<string>("");
  const [minStock, setMinStock] = useState(0);
  const [isHidden, setIsHidden] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (category) {
      setName(category.name);
      setDescription(category.description ?? "");
      setColor(category.color);
      setIcon(category.icon);
      setSortOrder(category.sort_order);
      // Wave 28-C — read both prices. Pre-Wave-28-C the form mirrored
      // a single value into both columns; now they're separate.
      setDefaultPurchasePrice(
        category.default_purchase_price_usd?.toString() ?? "",
      );
      setDefaultSalePrice(
        category.default_sale_price_usd?.toString() ??
          // Legacy fallback: if only the old default_price_usd is set,
          // surface it as the sale price (matches mig 059 snapshot
          // trigger semantics — proxies inherited that as
          // sale_price_usd via the "single price" path).
          category.default_price_usd?.toString() ??
          "",
      );
      setDefaultCountry(category.default_country ?? "");
      setDefaultProxyType(category.default_proxy_type ?? "");
      setDefaultIsp(category.default_isp ?? "");
      setDefaultVendorSource(category.default_vendor_source ?? "");
      // Wave 26-C — canonicalise legacy default_network_type values
      // when populating the edit dialog so the Select widget shows
      // the correct option (legacy "IPv4" → "datacenter_ipv4").
      // Without this the Select would show "Chưa phân loại" since
      // "IPv4" doesn't match any option's value attribute.
      setDefaultNetworkType(
        normalizeNetworkType(category.default_network_type) ?? "",
      );
      setMinStock(category.min_stock_alert);
      setIsHidden(category.is_hidden);
    } else {
      setName("");
      setDescription("");
      setColor("purple");
      setIcon("folder");
      setSortOrder(0);
      setDefaultPurchasePrice("");
      setDefaultSalePrice("");
      setDefaultCountry("");
      setDefaultProxyType("");
      setDefaultIsp("");
      setDefaultVendorSource("");
      setDefaultNetworkType("");
      setMinStock(0);
      setIsHidden(false);
    }
  }, [open, category]);

  const canSave = !submitting && name.trim().length > 0;

  // Wave 28 hotfix — block accidental "ẩn danh mục" toggle from
  // mass-hiding every proxy in production. Tracks the user's
  // pending-toggle intent so the typed-confirm dialog can gate the
  // save() call.
  const proxyCount = category?.proxy_count ?? 0;
  const turningHiddenOn =
    isEdit && isHidden === true && category?.is_hidden === false;
  const [hideConfirmOpen, setHideConfirmOpen] = useState(false);

  async function save() {
    // If the admin is turning is_hidden ON for a category that currently
    // has proxies, intercept and require typed confirmation. The
    // dangerous-confirm dialog forces the admin to type a phrase, so
    // muscle-memory clicks can't trigger a mass-hide.
    if (turningHiddenOn && proxyCount > 0 && !hideConfirmOpen) {
      setHideConfirmOpen(true);
      return;
    }
    setSubmitting(true);
    try {
      // Wave 28-C — separate purchase + sale prices. Both nullable
      // (admin can leave either blank). For back-compat with mig 059
      // snapshot trigger, also mirror the sale price into the legacy
      // `default_price_usd` column so existing proxies that read the
      // legacy column don't see NULL after admins move to the
      // two-input form.
      const numericPurchase = defaultPurchasePrice
        ? Number(defaultPurchasePrice)
        : null;
      const numericSale = defaultSalePrice ? Number(defaultSalePrice) : null;
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        color,
        icon,
        sort_order: sortOrder,
        // Wave 28-C — three price fields written together for
        // bidirectional compat. `default_price_usd` mirrors
        // `default_sale_price_usd` (legacy reads).
        default_price_usd: numericSale,
        default_purchase_price_usd: numericPurchase,
        default_sale_price_usd: numericSale,
        // Wave 22G snapshot defaults — null when blank so the
        // backend treats them as absent rather than empty strings.
        default_country: defaultCountry.trim() || null,
        default_proxy_type: defaultProxyType || null,
        default_isp: defaultIsp.trim() || null,
        default_vendor_source: defaultVendorSource.trim() || null,
        // Wave 22J → 26-C — proxy classification default. Normalise
        // before submit so even if the form value gets out of sync
        // with the canonical enum (e.g. via injected legacy data),
        // the API stores a clean value.
        default_network_type: normalizeNetworkType(defaultNetworkType),
        min_stock_alert: minStock,
      };
      if (isEdit) body.is_hidden = isHidden;

      const res = await fetch(
        isEdit ? `/api/categories/${category.id}` : "/api/categories",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error ?? `Failed (${res.status})`);
        return;
      }
      toast.success(isEdit ? "Category updated" : "Category created");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  // Wave 28-E [P0] — block sentinel from being renamed via the form.
  // The DB triggers + API return 403 anyway; this disables inputs
  // upfront so admin never sends the bad request.
  const isSystemCategory = isDefaultCategory(category);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Sửa danh mục" : "Danh mục mới"}</DialogTitle>
          <DialogDescription>
            Tham số mặc định (loại / quốc gia / giá) sẽ được prefill khi
            admin thêm proxy mới vào danh mục này. Toggle ẩn cascade — ẩn
            danh mục thì TOÀN BỘ proxy thuộc danh mục cũng ẩn theo.
          </DialogDescription>
        </DialogHeader>

        {isSystemCategory && (
          <div className="flex items-start gap-2 rounded-md border border-slate-700/50 bg-slate-900/40 p-3 text-xs text-slate-400">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium text-slate-300">
                Danh mục hệ thống "Mặc định"
              </p>
              <p>
                Không thể đổi tên hoặc ẩn — đây là danh mục dự phòng cho
                proxy chưa phân loại. Bạn vẫn có thể chỉnh giá mua / giá
                bán / quốc gia mặc định để proxy tự động kế thừa khi
                được re-home về đây.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
          <div className="space-y-1">
            <Label htmlFor="name">
              Tên danh mục *
              {isSystemCategory && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  (khoá)
                </span>
              )}
            </Label>
            <Input
              id="name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder="US Residential — Premium"
              disabled={isSystemCategory}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="desc">Mô tả</Label>
            <Textarea
              id="desc"
              rows={2}
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ghi chú cho admin khác (tuỳ chọn)"
            />
          </div>

          {/*
            Wave 28-C — Color picker only. The icon picker (folder,
            globe, shield, …) was removed: user found the 8 icons
            arbitrary. Default icon stays "folder" via state.
          */}
          <div className="space-y-1">
            <Label>Màu</Label>
            <div className="flex flex-wrap gap-1.5">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`size-11 rounded-md border-2 ${
                    color === c ? "border-foreground" : "border-transparent"
                  }`}
                  style={{ backgroundColor: cssColorFor(c) }}
                  aria-label={`Chọn màu ${c}`}
                  aria-pressed={color === c}
                />
              ))}
            </div>
          </div>

          {/*
            Wave 28-C — purchase + sale price split. Two independent
            inputs, both nullable. Soft warning if sale < purchase
            but allow save (clear-stock / loss-leader). Currency
            hint says USD explicitly so admin doesn't accidentally
            type VND amounts.
          */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="purchase-price">Giá mua ($)</Label>
              <Input
                id="purchase-price"
                type="number"
                step="0.01"
                min="0"
                value={defaultPurchasePrice}
                onChange={(e) => setDefaultPurchasePrice(e.target.value)}
                placeholder="VD: 1.20"
              />
              <p className="text-[10px] text-muted-foreground">
                USD — giá admin trả nhà cung cấp
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sale-price">Giá bán ($)</Label>
              <Input
                id="sale-price"
                type="number"
                step="0.01"
                min="0"
                value={defaultSalePrice}
                onChange={(e) => setDefaultSalePrice(e.target.value)}
                placeholder="VD: 2.00"
              />
              <p className="text-[10px] text-muted-foreground">
                USD — giá user trả qua bot
              </p>
            </div>
          </div>

          {/* Wave 28-C — soft warning if sale < purchase. Doesn't
              block save (clear-stock / promotion case). */}
          {defaultPurchasePrice &&
            defaultSalePrice &&
            Number(defaultSalePrice) < Number(defaultPurchasePrice) && (
              <p className="rounded-md border border-amber-300/40 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
                ⚠ Giá bán (${defaultSalePrice}) thấp hơn giá mua ($
                {defaultPurchasePrice}). Vẫn lưu nếu bạn muốn bán lỗ /
                clear-stock — chỉ là cảnh báo.
              </p>
            )}

          <div className="space-y-1">
            <Label htmlFor="minstock">Cảnh báo tồn kho</Label>
            <Input
              id="minstock"
              type="number"
              min={0}
              value={minStock}
              onChange={(e) => setMinStock(Math.max(0, Number(e.target.value) || 0))}
              placeholder="VD: 50"
            />
            <p className="text-[10px] text-muted-foreground">
              Hiện cảnh báo trên dashboard khi số proxy còn dưới mức này.
            </p>
          </div>

          {/* Wave 22G — snapshot defaults section */}
          <div className="space-y-2 rounded-md border border-dashed bg-muted/20 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Tham số mặc định cho proxy mới
            </p>
            <p className="text-xs text-muted-foreground">
              Khi thêm proxy vào danh mục này, các trường dưới sẽ tự fill.
              Admin vẫn có thể override per-proxy. Sửa ở đây KHÔNG ảnh hưởng
              proxy đã có (snapshot, không inheritance).
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="def-type">Giao thức</Label>
                <select
                  id="def-type"
                  value={defaultProxyType}
                  onChange={(e) => setDefaultProxyType(e.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">— không —</option>
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="socks5">SOCKS5</option>
                </select>
                <p className="text-[10px] text-muted-foreground">HTTP / HTTPS / SOCKS5</p>
              </div>
              <div className="space-y-1">
                {/* Wave 22AB — Phân loại → Loại mạng */}
                <Label htmlFor="def-network-type">Loại mạng</Label>
                <select
                  id="def-network-type"
                  value={defaultNetworkType}
                  onChange={(e) => setDefaultNetworkType(e.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">— không —</option>
                  {NETWORK_TYPE_VALUES.map((nt) => (
                    <option key={nt} value={nt}>
                      {NETWORK_TYPE_LABEL[nt as NetworkType]}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground">ISP / Datacenter / Dân cư / Mobile</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="def-country">Quốc gia</Label>
                <Input
                  id="def-country"
                  value={defaultCountry}
                  onChange={(e) => setDefaultCountry(e.target.value)}
                  placeholder="VD: VN, US, JP"
                  maxLength={64}
                />
              </div>
              <div className="space-y-1">
                {/* Wave 28-C — vendor source surfaced in form. Was on
                    schema since Wave 22K but only the API persisted it
                    (form silently dropped). */}
                <Label htmlFor="def-vendor">Nguồn</Label>
                <Input
                  id="def-vendor"
                  value={defaultVendorSource}
                  onChange={(e) => setDefaultVendorSource(e.target.value)}
                  placeholder="VD: Proxy-Seller, Self-built"
                  maxLength={200}
                />
                <p className="text-[10px] text-muted-foreground">
                  Tên nhà cung cấp (free-text)
                </p>
              </div>
              {/* Wave 22Y — default ISP field removed from category UI;
                  the column stays on categories table for backward-compat
                  but no longer surfaced in the form. */}
            </div>
          </div>

          {isEdit && !isSystemCategory && (
            <label
              className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                turningHiddenOn && proxyCount > 0
                  ? "border-destructive/50 bg-destructive/5"
                  : ""
              }`}
            >
              <input
                type="checkbox"
                checked={isHidden}
                onChange={(e) => setIsHidden(e.target.checked)}
                className="mt-0.5 size-4"
              />
              <span className="space-y-1">
                <span className="block">
                  <strong>Ẩn danh mục</strong> — toàn bộ{" "}
                  <span className="font-semibold text-destructive">
                    {proxyCount} proxy
                  </span>{" "}
                  thuộc danh mục này sẽ ẩn khỏi list mặc định, không phân phối
                  qua bot. Bật lại sẽ unhide hết.
                </span>
                {turningHiddenOn && proxyCount > 0 && (
                  <span className="flex items-start gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Bấm <strong>Lưu</strong> sẽ yêu cầu xác nhận thêm — gõ
                      đúng cụm từ để tránh ẩn nhầm.
                    </span>
                  </span>
                )}
              </span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Huỷ
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {submitting ? <Loader2 className="animate-spin" /> : <Save />}
            {isEdit ? "Lưu" : "Tạo"}
          </Button>
        </DialogFooter>

        {/* Wave 28 hotfix — typed-confirm gate for mass-hiding. */}
        <DangerousConfirmDialog
          open={hideConfirmOpen}
          onOpenChange={setHideConfirmOpen}
          title={`Ẩn danh mục "${category?.name ?? ""}" (${proxyCount} proxy)?`}
          description={
            <div className="space-y-2 text-sm">
              <p>
                Sau khi xác nhận:{" "}
                <strong>{proxyCount} proxy</strong> trong danh mục này sẽ:
              </p>
              <ul className="list-inside list-disc space-y-1 text-muted-foreground">
                <li>Biến mất khỏi <code>/proxies</code> mặc định</li>
                <li>KHÔNG phân phối qua bot Telegram</li>
                <li>KHÔNG xuất hiện trong auto-allocate</li>
              </ul>
              <p className="text-muted-foreground">
                Có thể unhide bằng cách tắt toggle này. Dữ liệu KHÔNG mất.
              </p>
              <p className="text-xs text-muted-foreground">
                Gõ <code className="rounded bg-muted px-1 font-mono">AN DANH MUC</code> để xác nhận.
              </p>
            </div>
          }
          confirmString="AN DANH MUC"
          actionLabel={`Ẩn ${proxyCount} proxy`}
          loading={submitting}
          onConfirm={async () => {
            // Re-enter save() — the guard at the top will see
            // hideConfirmOpen=true and skip the gate. Close the
            // typed-confirm dialog regardless of save() outcome so
            // the admin isn't stuck if the API errors.
            try {
              await save();
            } finally {
              setHideConfirmOpen(false);
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function cssColorFor(name: string): string {
  // Map preset color tokens to actual CSS hex. Tailwind class strings
  // can't be applied via inline style, so we keep this small map. Add
  // entries here when COLOR_PRESETS grows.
  const map: Record<string, string> = {
    purple: "#a855f7",
    blue: "#3b82f6",
    green: "#22c55e",
    yellow: "#eab308",
    red: "#ef4444",
    pink: "#ec4899",
    indigo: "#6366f1",
    gray: "#6b7280",
  };
  return map[name] ?? "#a855f7";
}
