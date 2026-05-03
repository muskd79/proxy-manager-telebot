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
import { z } from "zod";
import { toast } from "sonner";
import {
  NETWORK_TYPE_VALUES,
  NETWORK_TYPE_LABEL,
  type NetworkType,
} from "@/lib/proxy-labels";
import { CategoryPicker, type CategoryOptionLite } from "./category-picker";

const proxyTypeValues = ["http", "https", "socks5"] as const;

const proxySchema = z.object({
  host: z.string().min(1, "Bắt buộc nhập host"),
  port: z.coerce.number().int().min(1).max(65535, "Port phải nằm trong khoảng 1-65535"),
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
});

interface ProxyFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proxy?: Proxy | null;
  onSave: (data: Record<string, unknown>) => Promise<void>;
}

/**
 * Wave 26-B (gap 1.1) — single source of truth for form initial state.
 * Pre-fix the inline initializer ran ONCE on mount, so admins editing
 * proxy A → closing → editing proxy B saw A's data prefilled. Now both
 * the initial useState() AND the prop-change useEffect call this.
 */
function buildInitialFormData(proxy: Proxy | null | undefined) {
  return {
    host: proxy?.host || "",
    port: proxy?.port?.toString() || "",
    type: proxy?.type || "http",
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
  };
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
  const [countries, setCountries] = useState<string[]>([]);
  const [categories, setCategories] = useState<CategoryFullDefaults[]>([]);

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

  useEffect(() => {
    fetch("/api/proxies/stats")
      .then((r) => r.json())
      .then((d) => {
        if (d.data?.countries) setCountries(d.data.countries);
      })
      .catch(() => {});

    fetch("/api/categories")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.data)) {
          setCategories(
            (d.data as Array<{
              id: string;
              name: string;
              default_country?: string | null;
              default_proxy_type?: string | null;
              default_network_type?: string | null;
            }>).map((c) => ({
              id: c.id,
              name: c.name,
              default_country: c.default_country ?? null,
              default_proxy_type: c.default_proxy_type ?? null,
              default_network_type: c.default_network_type ?? null,
            })),
          );
        }
      })
      .catch(() => {});
  }, []);

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
    const defaultNetworkType =
      cat.default_network_type &&
      (NETWORK_TYPE_VALUES as readonly string[]).includes(cat.default_network_type)
        ? (cat.default_network_type as NetworkType)
        : null;

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
        network_type: formData.network_type || null,
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
        // type / network_type / country / category_id. Admins commonly
        // batch-create proxies under the same category + country +
        // protocol — only the host/port differs.
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
              onCategoryCreated={(c) => setCategories((prev) => [...prev, c])}
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
            <p className="text-xs text-muted-foreground">
              Để trống nếu proxy không có hạn sử dụng cố định.
            </p>
          </div>

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
