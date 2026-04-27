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

const ICON_PRESETS = [
  "tag",
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
  const [icon, setIcon] = useState<string>("tag");
  const [sortOrder, setSortOrder] = useState(0);
  const [defaultPrice, setDefaultPrice] = useState("");
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
      setMinStock(category.min_stock_alert);
      setIsHidden(category.is_hidden);
    } else {
      setName("");
      setDescription("");
      setColor("purple");
      setIcon("tag");
      setSortOrder(0);
      setDefaultPrice("");
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
          <DialogTitle>{isEdit ? "Edit category" : "New category"}</DialogTitle>
          <DialogDescription>
            Strong-category metadata. The proxies list filters by category, the
            dashboard rolls up cost per category, and the bulk-assign UI moves
            proxies between categories.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder="US Residential — Premium"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="desc">Description</Label>
            <Textarea
              id="desc"
              rows={2}
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional context for other admins"
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
                    className={`size-7 rounded-md border-2 ${
                      color === c ? "border-foreground" : "border-transparent"
                    }`}
                    style={{ backgroundColor: cssColorFor(c) }}
                    aria-label={`color ${c}`}
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
              <Label htmlFor="sort">Sort order</Label>
              <Input
                id="sort"
                type="number"
                min={0}
                value={sortOrder}
                onChange={(e) => setSortOrder(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="price">Default price ($)</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                min="0"
                value={defaultPrice}
                onChange={(e) => setDefaultPrice(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="minstock">Min stock alert</Label>
              <Input
                id="minstock"
                type="number"
                min={0}
                value={minStock}
                onChange={(e) => setMinStock(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
          </div>

          {isEdit && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isHidden}
                onChange={(e) => setIsHidden(e.target.checked)}
              />
              <span>
                Hidden — proxies in this category stay in the inventory but the
                category does not appear in the bot's <code>/getproxy</code>{" "}
                category picker.
              </span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {submitting ? <Loader2 className="animate-spin" /> : <Save />}
            {isEdit ? "Save" : "Create"}
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
