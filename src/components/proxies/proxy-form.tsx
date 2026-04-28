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

const proxyTypeValues = ["http", "https", "socks5"] as const;

const proxySchema = z.object({
  host: z.string().min(1, "Host is required"),
  port: z.coerce.number().int().min(1).max(65535, "Port must be 1-65535"),
  type: z.enum(proxyTypeValues),
  username: z.string().optional(),
  password: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  isp: z.string().optional(),
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
    username: proxy?.username || "",
    password: proxy?.password || "",
    country: proxy?.country || "",
    city: proxy?.city || "",
    isp: proxy?.isp || "",
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
        username: formData.username || null,
        password: formData.password || null,
        country: formData.country || null,
        city: formData.city || null,
        isp: formData.isp || null,
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
          <DialogTitle>{isEdit ? "Edit Proxy" : "Add Proxy"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the proxy details below."
              : "Enter the proxy details to add a new proxy."}
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
              />
              {errors.host && (
                <p className="text-xs text-destructive">{errors.host}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="port">Port *</Label>
              <Input
                id="port"
                placeholder="8080"
                type="number"
                value={formData.port}
                onChange={(e) => handleChange("port", e.target.value)}
                aria-invalid={!!errors.port}
              />
              {errors.port && (
                <p className="text-xs text-destructive">{errors.port}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Type *</Label>
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
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                placeholder="Optional"
                value={formData.username}
                onChange={(e) => handleChange("username", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Optional"
                value={formData.password}
                onChange={(e) => handleChange("password", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                list="country-list"
                placeholder="e.g. US, VN, JP"
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
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                placeholder="New York"
                value={formData.city}
                onChange={(e) => handleChange("city", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="isp">ISP</Label>
              <Input
                id="isp"
                placeholder="Optional"
                value={formData.isp}
                onChange={(e) => handleChange("isp", e.target.value)}
              />
            </div>
          </div>

          {/* Wave 22C: tags input removed. Strong categories supersede flat
              tags — assign via /categories admin page or the bulk-assign
              dropdown on the /proxies list. */}

          <div className="space-y-2">
            <Label htmlFor="expires_at">Expires At</Label>
            <Input
              id="expires_at"
              type="date"
              value={formData.expires_at}
              onChange={(e) => handleChange("expires_at", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Additional notes..."
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
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : isEdit ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
