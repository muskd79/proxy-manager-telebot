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
import {
  NETWORK_TYPE_VALUES,
  NETWORK_TYPE_LABEL,
  type NetworkType,
} from "@/lib/proxy-labels";

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
  // Wave 22Y — ISP field removed from UI (kept in DB for legacy imports)
  // Wave 22C: tags removed in favour of categories. category_id is set
  // via the bulk-assign UI on /proxies; the per-proxy form stays simple.
  notes: z.string().optional(),
  expires_at: z.string().optional(),
});

interface ProxyFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proxy?: Proxy | null;
  onSave: (data: Record<string, unknown>) => Promise<void>;
}

export function ProxyForm({
  open,
  onOpenChange,
  proxy,
  onSave,
}: ProxyFormProps) {
  const isEdit = !!proxy;
  const [formData, setFormData] = useState({
    host: proxy?.host || "",
    port: proxy?.port?.toString() || "",
    type: proxy?.type || "http",
    network_type: (proxy?.network_type ?? "") as NetworkType | "",
    username: proxy?.username || "",
    password: proxy?.password || "",
    country: proxy?.country || "",
    city: proxy?.city || "",
    notes: proxy?.notes || "",
    expires_at: proxy?.expires_at
      ? new Date(proxy.expires_at).toISOString().split("T")[0]
      : "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [countries, setCountries] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/proxies/stats")
      .then((r) => r.json())
      .then((d) => {
        if (d.data?.countries) setCountries(d.data.countries);
      })
      .catch(() => {});
  }, []);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

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
        notes: formData.notes || null,
        expires_at: formData.expires_at
          ? new Date(formData.expires_at).toISOString()
          : null,
      };

      await onSave(data);
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to save proxy:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Sửa proxy" : "Thêm proxy"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Cập nhật thông tin proxy bên dưới."
              : "Nhập thông tin proxy mới. Có thể bỏ trống các trường tuỳ chọn."}
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

          {/* Wave 22C: tags input removed. Strong categories supersede. */}

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
            <Button type="submit" disabled={saving}>
              {saving ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
