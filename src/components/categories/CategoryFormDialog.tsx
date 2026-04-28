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
import type { ProxyCategory } from "@/types/database";
import { Loader2, Save } from "lucide-react";
import {
  NETWORK_TYPE_VALUES,
  NETWORK_TYPE_LABEL,
  type NetworkType,
} from "@/lib/proxy-labels";

/**
 * Create / edit dialog for proxy_categories.
 *
 * Single component handles both modes:
 *   - When `category` is null  -> create flow, POST /api/categories
 *   - When `category` is set   -> edit flow, PATCH /api/categories/[id]
 *
 * Form fields match the Wave 22A schema: name, description, color,
 * icon, sort_order, default_price_usd, min_stock_alert. is_hidden
 * is exposed only in edit mode (not on create — admin shouldn't
 * create a hidden category).
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

// Wave 22G: replaced "tag" with "folder" as default. The "tag" icon
// misleads — tags concept was deprecated (mig 028 → 036).
const ICON_PRESETS = [
  "folder",
  "globe",
  "shield",
  "zap",
  "star",
  "flame",
  "rocket",
  "package",
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
  const [icon, setIcon] = useState<string>("folder");
  const [sortOrder, setSortOrder] = useState(0);
  const [defaultPrice, setDefaultPrice] = useState("");
  // Wave 22G — rich-category snapshot defaults.
  const [defaultCountry, setDefaultCountry] = useState("");
  const [defaultProxyType, setDefaultProxyType] = useState<string>("");
  const [defaultIsp, setDefaultIsp] = useState("");
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
      setDefaultPrice(category.default_price_usd?.toString() ?? "");
      setDefaultCountry(category.default_country ?? "");
      setDefaultProxyType(category.default_proxy_type ?? "");
      setDefaultIsp(category.default_isp ?? "");
      setDefaultNetworkType(category.default_network_type ?? "");
      setMinStock(category.min_stock_alert);
      setIsHidden(category.is_hidden);
    } else {
      setName("");
      setDescription("");
      setColor("purple");
      setIcon("folder");
      setSortOrder(0);
      setDefaultPrice("");
      setDefaultCountry("");
      setDefaultProxyType("");
      setDefaultIsp("");
      setDefaultNetworkType("");
      setMinStock(0);
      setIsHidden(false);
    }
  }, [open, category]);

  const canSave = !submitting && name.trim().length > 0;

  async function save() {
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        color,
        icon,
        sort_order: sortOrder,
        default_price_usd: defaultPrice ? Number(defaultPrice) : null,
        // Wave 22G snapshot defaults — null when blank so the
        // backend treats them as absent rather than empty strings.
        default_country: defaultCountry.trim() || null,
        default_proxy_type: defaultProxyType || null,
        default_isp: defaultIsp.trim() || null,
        // Wave 22J — proxy classification default.
        default_network_type: defaultNetworkType || null,
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

        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
          <div className="space-y-1">
            <Label htmlFor="name">Tên danh mục *</Label>
            <Input
              id="name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder="US Residential — Premium"
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Color</Label>
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

            <div className="space-y-1">
              <Label>Icon</Label>
              <select
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {ICON_PRESETS.map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="sort">Thứ tự</Label>
              <Input
                id="sort"
                type="number"
                min={0}
                value={sortOrder}
                onChange={(e) => setSortOrder(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
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
            </div>
            <div className="space-y-1">
              <Label htmlFor="price">Giá mặc định ($)</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                min="0"
                value={defaultPrice}
                onChange={(e) => setDefaultPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
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
                <Label htmlFor="def-network-type">Phân loại</Label>
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
              {/* Wave 22Y — default ISP field removed from category UI;
                  the column stays on categories table for backward-compat
                  but no longer surfaced in the form. */}
            </div>
          </div>

          {isEdit && (
            <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                checked={isHidden}
                onChange={(e) => setIsHidden(e.target.checked)}
                className="size-4"
              />
              <span>
                <strong>Ẩn danh mục</strong> — toàn bộ {category?.proxy_count ?? 0} proxy
                thuộc danh mục này sẽ ẩn khỏi list mặc định, không phân phối
                qua bot. Bật lại sẽ unhide hết.
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
