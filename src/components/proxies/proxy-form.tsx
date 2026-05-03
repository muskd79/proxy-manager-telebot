"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
// Wave 22C: Badge + X removed with the tags input.
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Proxy } from "@/types/database";
import { toast } from "sonner";
import {
  NETWORK_TYPE_VALUES,
  NETWORK_TYPE_LABEL,
  normalizeNetworkType,
  type NetworkType,
} from "@/lib/proxy-labels";
import { CategoryPicker, type CategoryOptionLite } from "./category-picker";
import { useSharedCache, useSharedQuery } from "@/lib/shared-cache";
// Wave 26-D-pre2/G — schema + initial-data extracted to subdir for
// maintainability. The component file dropped from 718 → ~580 lines
// after this split.
import { proxySchema, type ProxyFormData } from "./proxy-form/schema";
import { buildInitialFormData } from "./proxy-form/build-initial";

interface ProxyFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proxy?: Proxy | null;
  onSave: (data: Record<string, unknown>) => Promise<void>;
}

/**
 * Wave 26-B (gap 1.7) — extended category lite used to auto-fill
 * country/proxy_type/network_type/expires_at from category defaults.
 * Mirrors ProxyImport's category-default useEffect so the single-
 * proxy form behaves the same as the bulk wizard.
 */
interface CategoryFullDefaults extends CategoryOptionLite {
  default_network_type?: string | null;
}

export function ProxyForm({
  open,
  onOpenChange,
  proxy,
  onSave,
}: ProxyFormProps) {
  const isEdit = !!proxy;
  const [formData, setFormData] = useState(() => buildInitialFormData(proxy));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const cache = useSharedCache();

  // Wave 26-C (gap 6.3) — countries + categories now come from the
  // shared cache. Pre-fix every Sửa dialog opening re-fetched both
  // lists even though they hadn't changed since page mount. With
  // `useSharedQuery` the first read populates the cache, every
  // subsequent dialog mount within the TTL window is zero network.
  const { data: stats } = useSharedQuery<{
    countries?: string[];
    byCountry?: Record<string, number>;
  }>(
    open ? "api:proxies:stats" : null,
    async () => {
      const r = await fetch("/api/proxies/stats");
      const d = await r.json();
      return (d?.data ?? {}) as {
        countries?: string[];
        byCountry?: Record<string, number>;
      };
    },
  );
  const countries: string[] =
    stats?.countries && Array.isArray(stats.countries)
      ? stats.countries
      : stats?.byCountry
        ? Object.keys(stats.byCountry).sort()
        : [];
  const { data: categories = [] } = useSharedQuery<CategoryFullDefaults[]>(
    open ? "api:categories:full" : null,
    async () => {
      const r = await fetch("/api/categories");
      const d = await r.json();
      if (!Array.isArray(d?.data)) return [];
      return (
        d.data as Array<{
          id: string;
          name: string;
          default_country?: string | null;
          default_proxy_type?: string | null;
          default_network_type?: string | null;
        }>
      ).map((c) => ({
        id: c.id,
        name: c.name,
        default_country: c.default_country ?? null,
        default_proxy_type: c.default_proxy_type ?? null,
        default_network_type: c.default_network_type ?? null,
      }));
    },
  );

  // Wave 26-B (gap 1.1) — reset form when the `proxy` prop changes
  // OR when the dialog reopens. Pre-fix: stale data from previous
  // proxy reused on subsequent edits. The `open` dependency catches
  // the case where admin closes a Sửa dialog then reopens "Thêm đơn"
  // (proxy goes from non-null to null).
  useEffect(() => {
    if (open) {
      setFormData(buildInitialFormData(proxy));
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proxy?.id, open]);

  // Wave 26-C — countries + categories were fetched here pre-26-C
  // and now flow through useSharedQuery above. The category-defaults
  // useEffect below still runs unchanged (consumes `categories`).

  // Wave 26-B (gap 1.7) — auto-fill category defaults. Pre-fix the
  // single-proxy form ignored category defaults (only the import
  // wizard used them). Two surfaces, two behaviours = inconsistent.
  // Now both honor: when a category is picked AND the corresponding
  // form field is still empty, fill it from the default. Existing
  // values are NEVER overwritten — admin's typed value wins.
  useEffect(() => {
    if (!formData.category_id) return;
    const cat = categories.find((c) => c.id === formData.category_id);
    if (!cat) return;

    // Narrow the category defaults back into the form's strict literal
    // types. The category endpoint returns `default_proxy_type` /
    // `default_network_type` as `string | null`; we only adopt them
    // when they match the corresponding enum.
    const validProxyTypes = ["http", "https", "socks5"] as const;
    const defaultType =
      cat.default_proxy_type &&
      (validProxyTypes as readonly string[]).includes(cat.default_proxy_type)
        ? (cat.default_proxy_type as (typeof validProxyTypes)[number])
        : null;
    // Wave 26-C — normalise the category's default_network_type so
    // legacy values (`IPv4`, `Dân cư`, `4G`) are adopted instead of
    // being silently dropped. Pre-fix, only canonical enum values
    // were accepted, so a category created before Wave 26-A would
    // have its default fail to propagate to new proxies.
    const defaultNetworkType = normalizeNetworkType(cat.default_network_type);

    setFormData((prev) => ({
      ...prev,
      country: prev.country || cat.default_country || "",
      type: prev.type || defaultType || "http",
      network_type: prev.network_type || defaultNetworkType || "",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.category_id, categories]);

  function handleChange(field: string, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  /**
   * Wave 26-B (gap 1.5) — split submit into "save + close" and
   * "save + continue (reset form, keep dialog open, keep category)".
   * `mode` controls the post-save behaviour.
   */
  async function performSave(mode: "close" | "continue") {
    const result = proxySchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const pathKey = issue.path?.[0];
        if (pathKey !== undefined) {
          fieldErrors[String(pathKey)] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    setSaving(true);
    try {
      const data: Record<string, unknown> = {
        host: formData.host,
        port: parseInt(formData.port),
        type: formData.type,
        // Wave 26-C — normalise on submit too. The Select widget
        // already constrains values to canonical enum, but a stale
        // form re-mount or external script could inject a legacy
        // alias; canonicalise once more so the API contract stays
        // strict regardless of the form's input source.
        network_type: normalizeNetworkType(formData.network_type),
        username: formData.username || null,
        password: formData.password || null,
        country: formData.country || null,
        city: formData.city || null,
        // Wave 22Y — isp omitted from UI submissions
        category_id: formData.category_id || null,
        notes: formData.notes || null,
        expires_at: formData.expires_at
          ? new Date(formData.expires_at).toISOString()
          : null,
        // Wave 26-B (gap 1.3) — purchase metadata. Empty strings →
        // null so the route nulls out the column instead of writing
        // an empty string. Number fields parsed; NaN guarded as null.
        purchase_date: formData.purchase_date || null,
        vendor_source: formData.vendor_source || null,
        purchase_price_usd: formData.purchase_price_usd
          ? Number(formData.purchase_price_usd)
          : null,
        sale_price_usd: formData.sale_price_usd
          ? Number(formData.sale_price_usd)
          : null,
      };

      // Snapshot the host/port BEFORE the save so the toast names the
      // proxy admin just acted on, not whatever leaks back from
      // optimistic state updates.
      const label = `${formData.host}:${formData.port}`;
      await onSave(data);

      // Wave 26-B (gap 1.2 + 2.2) — toast on success. Pre-fix the dialog
      // closed silently; admin had no positive confirmation.
      toast.success(
        isEdit ? `Đã cập nhật ${label}` : `Đã tạo ${label}`,
      );

      if (mode === "close") {
        onOpenChange(false);
      } else {
        // Wave 26-B (gap 1.5) — "Tạo và thêm tiếp": clear host / port /
        // username / password / city / notes / expires_at, but PRESERVE
        // type / network_type / country / category_id / purchase_date /
        // vendor_source / prices. Admins commonly batch-create proxies
        // under the same category + country + protocol + same vendor /
        // batch metadata — only the host/port differs.
        setFormData((prev) => ({
          ...prev,
          host: "",
          port: "",
          username: "",
          password: "",
          city: "",
          notes: "",
          expires_at: "",
        }));
        setErrors({});
      }
    } catch (err) {
      console.error("Failed to save proxy:", err);
      // Wave 26-B (gap 1.2) — surface the error explicitly so admin
      // doesn't see a quiet dialog that won't close. Network glitch
      // and validation failures both end up here.
      toast.error(
        err instanceof Error ? err.message : "Lưu proxy thất bại",
      );
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void performSave("close");
  }

  function handleSaveAndContinue() {
    void performSave("continue");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          {/* Wave 26-B (gap 1.4) — show host:port in edit-mode title.
              Pre-fix "Sửa proxy" was generic; admin scrolling a 1000-
              row list could lose track of which row they opened. */}
          <DialogTitle>
            {isEdit && proxy
              ? `Sửa ${proxy.host}:${proxy.port}`
              : "Thêm proxy mới"}
          </DialogTitle>
          {/* Wave 26-B (gap 1.8) — call out required fields explicitly. */}
          <DialogDescription>
            {isEdit
              ? "Cập nhật thông tin proxy bên dưới. Bắt buộc: Host + Cổng."
              : "Nhập thông tin proxy mới. Bắt buộc: Host + Cổng. Các trường khác tuỳ chọn."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="host">Host *</Label>
              <Input
                id="host"
                placeholder="192.168.1.1"
                value={formData.host}
                onChange={(e) => handleChange("host", e.target.value)}
                aria-invalid={!!errors.host}
                aria-describedby={errors.host ? "host-error" : undefined}
                aria-required="true"
              />
              {errors.host && (
                <p id="host-error" role="alert" className="text-xs text-destructive">
                  {errors.host}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="port">Cổng *</Label>
              <Input
                id="port"
                placeholder="8080"
                type="number"
                value={formData.port}
                onChange={(e) => handleChange("port", e.target.value)}
                aria-invalid={!!errors.port}
                aria-describedby={errors.port ? "port-error" : undefined}
                aria-required="true"
              />
              {errors.port && (
                <p id="port-error" role="alert" className="text-xs text-destructive">
                  {errors.port}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Giao thức *</Label>
              <Select
                value={formData.type}
                onValueChange={(val) => handleChange("type", val ?? formData.type)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="https">HTTPS</SelectItem>
                  <SelectItem value="socks5">SOCKS5</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Giao thức truyền tải: HTTP/HTTPS/SOCKS5</p>
            </div>
            <div className="space-y-2">
              {/* Wave 22AB — Phân loại → Loại mạng (rename to disambiguate
                  from "Danh mục" / category, which is user-managed). */}
              <Label>Loại mạng</Label>
              <Select
                value={formData.network_type || "_none"}
                onValueChange={(val) =>
                  handleChange("network_type", val === "_none" ? "" : val ?? "")
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder="Chưa chọn"
                    labels={{
                      _none: "Chưa chọn",
                      ...Object.fromEntries(
                        NETWORK_TYPE_VALUES.map((nt) => [
                          nt,
                          NETWORK_TYPE_LABEL[nt as NetworkType],
                        ]),
                      ),
                    }}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Chưa chọn</SelectItem>
                  {NETWORK_TYPE_VALUES.map((nt) => (
                    <SelectItem key={nt} value={nt}>
                      {NETWORK_TYPE_LABEL[nt as NetworkType]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Hạ tầng mạng: ISP / Datacenter / Dân cư / Mobile (giá trị
                cố định). Cần nhóm tuỳ chỉnh? Tạo "Danh mục" trên tab
                Quản lý proxy → Danh mục.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="username">Tên đăng nhập</Label>
              <Input
                id="username"
                placeholder="(tuỳ chọn)"
                value={formData.username}
                onChange={(e) => handleChange("username", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mật khẩu</Label>
              <Input
                id="password"
                type="password"
                placeholder="(tuỳ chọn)"
                value={formData.password}
                onChange={(e) => handleChange("password", e.target.value)}
              />
            </div>
          </div>

          {/* Wave 22Y — ISP field dropped; grid collapses 3→2 columns */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="country">Quốc gia</Label>
              <Input
                id="country"
                list="country-list"
                placeholder="VD: US, VN, JP"
                value={formData.country}
                onChange={(e) => handleChange("country", e.target.value)}
              />
              <datalist id="country-list">
                {countries.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">Thành phố</Label>
              <Input
                id="city"
                placeholder="VD: Hà Nội"
                value={formData.city}
                onChange={(e) => handleChange("city", e.target.value)}
              />
            </div>
          </div>

          {/* Wave 23B — Danh mục cho proxy lẻ. Có nút "+ Tạo danh mục
              mới" inline để admin không phải rời form. */}
          <div className="space-y-2">
            <Label>Danh mục</Label>
            <CategoryPicker
              value={formData.category_id}
              onValueChange={(id) => handleChange("category_id", id)}
              categories={categories}
              onCategoryCreated={(c) => {
                // Wave 26-C — cache write-through. Pre-fix the local
                // setCategories state diverged from the cache held by
                // OTHER components (Import wizard, /proxies page),
                // so the new category showed in this dialog only
                // until the next API read. Now: append to the
                // cache, every consumer's useSharedQuery picks it up.
                const prev =
                  cache.get<CategoryFullDefaults[]>("api:categories:full")?.data ??
                  [];
                cache.set<CategoryFullDefaults[]>("api:categories:full", {
                  data: [
                    ...prev,
                    {
                      id: c.id,
                      name: c.name,
                      default_country: c.default_country ?? null,
                      default_proxy_type: c.default_proxy_type ?? null,
                      default_network_type: null,
                    },
                  ],
                  fetchedAt: Date.now(),
                });
              }}
            />
            <p className="text-xs text-muted-foreground">
              Nhóm proxy theo danh mục để dễ giao + thống kê. Tuỳ chọn.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="expires_at">Ngày hết hạn</Label>
            <Input
              id="expires_at"
              type="date"
              value={formData.expires_at}
              onChange={(e) => handleChange("expires_at", e.target.value)}
            />
            {/* Wave 26-B (gap 1.6) — quick-fill suggestion mirrors the
                import wizard. Only renders when expires_at is empty AND
                a reference date exists (purchase_date set, or fall back
                to today for a brand-new proxy). */}
            {!formData.expires_at && (() => {
              const ref = formData.purchase_date || new Date().toISOString().slice(0, 10);
              const d = new Date(ref);
              if (Number.isNaN(d.getTime())) return null;
              d.setDate(d.getDate() + 30);
              const suggestion = d.toISOString().slice(0, 10);
              return (
                <p className="text-xs text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => handleChange("expires_at", suggestion)}
                    className="text-primary hover:underline"
                  >
                    Đề xuất 30 ngày sau: {suggestion}
                  </button>{" "}
                  · để trống = không giới hạn
                </p>
              );
            })()}
            {formData.expires_at && (
              <p className="text-xs text-muted-foreground">
                Để trống nếu proxy không có hạn sử dụng cố định.
              </p>
            )}
          </div>

          {/* Wave 26-B (gap 1.3) — Thông tin mua / bán collapsible.
              Pre-fix: import wizard set vendor_source/cost_usd/etc.;
              single-proxy Sửa form couldn't edit them. Now exposed in
              a <details> so casual creates aren't bloated; admins
              wanting to fix vendor/price open the section. */}
          <details className="rounded-md border bg-muted/20 p-3">
            <summary className="cursor-pointer text-sm font-medium select-none">
              Thông tin mua / bán
              <span className="ml-2 text-xs text-muted-foreground">
                (tuỳ chọn — nguồn, giá mua/bán, ngày mua)
              </span>
            </summary>
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="purchase_date">Ngày mua</Label>
                  <Input
                    id="purchase_date"
                    type="date"
                    value={formData.purchase_date}
                    onChange={(e) => handleChange("purchase_date", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vendor_source">Nguồn</Label>
                  <Input
                    id="vendor_source"
                    placeholder="VD: Proxy-Seller, Tự build"
                    value={formData.vendor_source}
                    onChange={(e) => handleChange("vendor_source", e.target.value)}
                    maxLength={200}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="purchase_price_usd">Giá mua ($)</Label>
                  <Input
                    id="purchase_price_usd"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={formData.purchase_price_usd}
                    onChange={(e) => handleChange("purchase_price_usd", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sale_price_usd">Giá bán ($)</Label>
                  <Input
                    id="sale_price_usd"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={formData.sale_price_usd}
                    onChange={(e) => handleChange("sale_price_usd", e.target.value)}
                  />
                  {/* Same lo/lai/break-even logic as the import wizard
                      (Wave 26-A commit 2). */}
                  {formData.purchase_price_usd && formData.sale_price_usd && (() => {
                    const buy = Number(formData.purchase_price_usd);
                    const sell = Number(formData.sale_price_usd);
                    if (!Number.isFinite(buy) || !Number.isFinite(sell)) return null;
                    const diff = sell - buy;
                    if (diff > 0) {
                      return <p className="text-xs text-emerald-500">Lãi: ${diff.toFixed(2)}</p>;
                    }
                    if (diff < 0) {
                      return (
                        <p className="text-xs text-amber-600">
                          [!] Bán &lt; mua — lỗ ${Math.abs(diff).toFixed(2)}. Kiểm tra lại?
                        </p>
                      );
                    }
                    return <p className="text-xs text-muted-foreground">Hoà vốn.</p>;
                  })()}
                </div>
              </div>
            </div>
          </details>

          <div className="space-y-2">
            <Label htmlFor="notes">Ghi chú</Label>
            <Textarea
              id="notes"
              placeholder="Ghi chú nội bộ (tuỳ chọn)"
              value={formData.notes}
              onChange={(e) => handleChange("notes", e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Huỷ
            </Button>
            {/* Wave 26-B (gap 1.5) — secondary "Tạo và thêm tiếp" button
                (create-mode only). Saves + resets host/port/credentials
                + keeps category/country/type so admins batch-create
                under the same group without reopening the dialog. */}
            {!isEdit && (
              <Button
                type="button"
                variant="secondary"
                onClick={handleSaveAndContinue}
                disabled={saving}
              >
                {saving ? "Đang lưu..." : "Tạo và thêm tiếp"}
              </Button>
            )}
            <Button type="submit" disabled={saving}>
              {saving ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
