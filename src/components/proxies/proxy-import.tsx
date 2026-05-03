"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Upload,
  CheckCircle,
  XCircle,
  Loader2,
  Radar,
  AlertCircle,
  ClipboardPaste,
} from "lucide-react";
import { toast } from "sonner";
import { ProxyType } from "@/types/database";
import type { ImportProxyResult } from "@/types/api";
import { CategoryPicker } from "./category-picker";
import { parseProxyLine as parseProxyLineLib } from "@/lib/proxy-parse";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";

/**
 * Wave 22I — Smart proxy import wizard.
 *
 * Workflow for "tao có 1000 proxy chưa phân loại":
 *   1. Paste / drop a TXT file with host:port:user:pass per line.
 *   2. Click "Auto-detect" → batch-probes via /api/proxies/probe-batch
 *      with concurrency 50. Each row is updated with detected type +
 *      alive flag + speed.
 *   3. Pick a category (optional) so all imported proxies inherit
 *      the category's defaults (loại / quốc gia / ISP per Wave 22G).
 *   4. Click Import → POST to /api/proxies/import with per-row
 *      detected type + bulk category_id.
 *
 * Privacy: probe path is fully self-built (TCP-only), no external
 * services touched. See Wave 22H notes in /lib/proxy-detect.ts.
 */

interface ProxyCategoryOption {
  id: string;
  name: string;
  default_country: string | null;
  default_proxy_type: ProxyType | null;
  default_isp: string | null;
  // Wave 22K — purchase-metadata defaults the category prefills.
  default_network_type: string | null;
  default_vendor_source: string | null;
  default_purchase_price_usd: number | null;
  default_sale_price_usd: number | null;
}

// Wave 22K — common "Phân loại" suggestions. Free text (admin-extensible)
// — typing a value not in this list is allowed.
const NETWORK_TYPE_SUGGESTIONS = [
  "ipv4",
  "ipv6",
  "isp",
  "residential",
  "mobile",
  "bandwidth",
  "static_residential",
] as const;

interface ParsedProxy {
  line: number;
  raw: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  valid: boolean;
  error?: string;
  // Wave 22I — populated by /api/proxies/probe-batch.
  detected_type?: ProxyType | null;
  alive?: boolean;
  speed_ms?: number;
}

export function ProxyImport() {
  const [parsedProxies, setParsedProxies] = useState<ParsedProxy[]>([]);
  const [proxyType, setProxyType] = useState<ProxyType>(ProxyType.HTTP);
  const [country, setCountry] = useState("");
  const [notes, setNotes] = useState("");
  // Wave 22Y → 22AB — ISP state kept ONLY so the category-default
  // useEffect doesn't crash when default_isp is set on legacy
  // categories. Field NOT exposed in UI; ALWAYS sent as null.
  const [isp] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  // Wave 22AB — paste textarea state. Pre-fix: only file-upload
  // input existed; users couldn't paste 1000 lines directly.
  const [pasteText, setPasteText] = useState("");
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  // Wave 22AB — auto-focus paste textarea when admin lands here
  // via the "Nhập hàng loạt" item of the Thêm proxy dropdown
  // (which routes to /proxies/import?mode=paste). The wizard
  // serves all 4 entry modes, but we hint with the URL so the
  // textarea/file-input gets immediate attention.
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("mode") === "paste") {
      pasteRef.current?.focus();
      pasteRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [searchParams]);

  // Wave 23B — auto-parse paste text (debounced 250ms). Pre-fix the
  // user had to click an extra "Phân tích" button; feedback was
  // "tao đâu có cần phân tích, tao cần thêm 1000 proxy đó vào". Now
  // typing/pasting in the textarea immediately produces the row
  // preview + the existing "Import N proxy" button is the only
  // primary action.
  useEffect(() => {
    const t = setTimeout(() => {
      if (pasteText.trim()) {
        parseContent(pasteText);
      } else {
        setParsedProxies([]);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasteText]);
  // Wave 22K — new fields user requested.
  const [networkType, setNetworkType] = useState("");
  const [vendorSource, setVendorSource] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [purchaseDate, setPurchaseDate] = useState<string>(today);
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [purchasePrice, setPurchasePrice] = useState<string>("");
  const [salePrice, setSalePrice] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeProgress, setProbeProgress] = useState(0);
  const [dropDead, setDropDead] = useState(true);
  const [result, setResult] = useState<ImportProxyResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [countries, setCountries] = useState<string[]>([]);
  const [categories, setCategories] = useState<ProxyCategoryOption[]>([]);

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
            (d.data as ProxyCategoryOption[]).map((c) => ({
              id: c.id,
              name: c.name,
              default_country: c.default_country,
              default_proxy_type: c.default_proxy_type,
              default_isp: c.default_isp,
              // Wave 22K — purchase metadata defaults from category.
              default_network_type: c.default_network_type ?? null,
              default_vendor_source: c.default_vendor_source ?? null,
              default_purchase_price_usd: c.default_purchase_price_usd ?? null,
              default_sale_price_usd: c.default_sale_price_usd ?? null,
            })),
          );
        }
      })
      .catch(() => {});
  }, []);

  // When admin picks a category, auto-fill the bulk fields with its
  // defaults (admin can still override per-form). Wave 22K extended:
  // also pulls network_type / vendor_source / purchase + sale prices.
  useEffect(() => {
    if (!categoryId) return;
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return;
    if (cat.default_country) setCountry(cat.default_country);
    if (cat.default_proxy_type) setProxyType(cat.default_proxy_type);
    // Wave 22AB — default_isp prefill removed (column dropped from UI)
    if (cat.default_network_type) setNetworkType(cat.default_network_type);
    if (cat.default_vendor_source) setVendorSource(cat.default_vendor_source);
    if (cat.default_purchase_price_usd != null)
      setPurchasePrice(String(cat.default_purchase_price_usd));
    if (cat.default_sale_price_usd != null)
      setSalePrice(String(cat.default_sale_price_usd));
  }, [categoryId, categories]);

  // Wave 23B-fix — parseProxyLine extracted to src/lib/proxy-parse.ts
  // so vitest can exercise it without mounting React. The component
  // still owns the parsedProxies state + UI; the helper is a pure
  // function shared with future server-side imports.
  function parseContent(content: string) {
    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    const parsed: ParsedProxy[] = lines.map((line, i) => parseProxyLineLib(line, i + 1));
    setParsedProxies(parsed);
    setResult(null);
    setProbeProgress(0);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => parseContent(ev.target?.result as string);
    reader.readAsText(file);
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => parseContent(ev.target?.result as string);
    reader.readAsText(file);
  }, []);

  /**
   * Wave 22I — batch-probe all valid rows. Calls /api/proxies/probe-batch
   * in chunks of 200 so the UI can show progress instead of one big spinner.
   * Each chunk concurrency is server-side (50 parallel).
   */
  async function handleProbe() {
    const valid = parsedProxies.filter((p) => p.valid);
    if (valid.length === 0) return;
    setProbing(true);
    setProbeProgress(0);
    try {
      const CHUNK = 200;
      const updates = new Map<number, Partial<ParsedProxy>>();
      for (let i = 0; i < valid.length; i += CHUNK) {
        const chunk = valid.slice(i, i + CHUNK);
        const res = await fetch("/api/proxies/probe-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proxies: chunk.map((p) => ({
              host: p.host,
              port: p.port,
              ref: String(p.line),
            })),
          }),
        });
        if (!res.ok) {
          const body = await res.json();
          toast.error(body.error || `Probe failed at chunk ${i}`);
          break;
        }
        const body = await res.json();
        type ProbeRow = {
          ref?: string;
          alive: boolean;
          type: ProxyType | null;
          speed_ms: number;
        };
        for (const r of body.data.results as ProbeRow[]) {
          const lineNum = Number(r.ref);
          if (Number.isFinite(lineNum)) {
            updates.set(lineNum, {
              detected_type: r.type,
              alive: r.alive,
              speed_ms: r.speed_ms,
            });
          }
        }
        setProbeProgress(Math.min(100, Math.round(((i + chunk.length) / valid.length) * 100)));
      }

      // Apply all updates in one setState pass to avoid re-renders.
      setParsedProxies((rows) =>
        rows.map((r) => {
          const u = updates.get(r.line);
          return u ? { ...r, ...u } : r;
        }),
      );
      const aliveCount = Array.from(updates.values()).filter((u) => u.alive).length;
      const deadCount = updates.size - aliveCount;
      toast.success(
        `Probed ${updates.size} — ${aliveCount} alive, ${deadCount} dead. Loại đã detect tự fill mỗi row.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Probe failed");
    } finally {
      setProbing(false);
    }
  }

  async function handleImport() {
    const valid = parsedProxies.filter((p) => p.valid);
    // If user probed + opted to drop dead, exclude dead rows.
    const target = dropDead && valid.some((p) => p.alive !== undefined)
      ? valid.filter((p) => p.alive !== false)
      : valid;

    if (target.length === 0) {
      toast.error("No proxies to import");
      return;
    }

    setImporting(true);
    try {
      const payloadProxies = target.map((p) => ({
        host: p.host,
        port: p.port,
        username: p.username,
        password: p.password,
        // Wave 22I: per-row detected type wins over the batch type.
        type: p.detected_type ?? proxyType,
        line: p.line,
        raw: p.raw,
      }));

      const res = await fetch("/api/proxies/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proxies: payloadProxies,
          type: proxyType,
          country: country || undefined,
          notes: notes || undefined,
          isp: isp || undefined,
          category_id: categoryId || null,
          // Wave 22K — bulk-applied per-proxy metadata.
          network_type: networkType || undefined,
          vendor_source: vendorSource || undefined,
          purchase_date: purchaseDate || undefined,
          expires_at: expiresAt || undefined,
          purchase_price_usd: purchasePrice
            ? Number(purchasePrice)
            : undefined,
          sale_price_usd: salePrice ? Number(salePrice) : undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setResult(data.data);
      } else {
        const body = await res.json();
        toast.error(body.error || "Import failed");
      }
    } catch (err) {
      console.error("Failed to import proxies:", err);
      toast.error("Failed to import proxies");
    } finally {
      setImporting(false);
    }
  }

  const validCount = parsedProxies.filter((p) => p.valid).length;
  const invalidCount = parsedProxies.filter((p) => !p.valid).length;
  const probedCount = parsedProxies.filter((p) => p.alive !== undefined).length;
  const aliveCount = parsedProxies.filter((p) => p.alive === true).length;
  const deadCount = parsedProxies.filter((p) => p.alive === false).length;
  const probedSummary = parsedProxies.reduce(
    (acc, p) => {
      if (p.alive && p.detected_type) {
        acc[p.detected_type] = (acc[p.detected_type] || 0) + 1;
      }
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="space-y-6">
      {/* Step 1: Upload */}
      <Card>
        <CardHeader>
          <CardTitle>1. Tải proxy lên</CardTitle>
          <CardDescription>
            Hỗ trợ: TXT (mỗi dòng 1 proxy theo dạng host:port:user:pass), CSV.
            Tối đa 10.000 proxy mỗi lần import.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Wave 22AB — paste textarea is the PRIMARY input. User
              feedback "vẫn chưa có chỗ dán 1000 proxy" confirmed the
              file-only UI was wrong. Now: paste OR file, both routed
              through the same parseContent() pipeline. */}
          <div className="space-y-2">
            <Label htmlFor="paste-area" className="flex items-center gap-2">
              <ClipboardPaste className="size-4" />
              Dán danh sách proxy
            </Label>
            <Textarea
              id="paste-area"
              ref={pasteRef}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={`209.101.202.62:49155:cad2s12342:WZGqzAc5d6\n89.19.58.220:50100:cad2s12342:WZGqzAc5d6\n...`}
              rows={8}
              className="font-mono text-xs"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Mỗi dòng 1 proxy theo dạng{" "}
                <code className="rounded bg-muted px-1 text-[11px]">host:port</code> hoặc{" "}
                <code className="rounded bg-muted px-1 text-[11px]">host:port:user:pass</code>.
                Tối đa 10.000 dòng / lần.
              </p>
              {parsedProxies.length > 0 && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  Đã đọc <span className="font-semibold text-foreground">{parsedProxies.length}</span> dòng
                </span>
              )}
            </div>
          </div>

          <div className="relative my-3 flex items-center">
            <div className="flex-1 border-t border-border/50" />
            <span className="px-3 text-xs uppercase text-muted-foreground">hoặc</span>
            <div className="flex-1 border-t border-border/50" />
          </div>

          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <Upload className="size-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-2">Kéo thả file vào đây, hoặc click để chọn</p>
            <Input type="file" accept=".txt,.csv" onChange={handleFileChange} className="max-w-xs mx-auto" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Danh mục</Label>
              <CategoryPicker
                value={categoryId}
                onValueChange={setCategoryId}
                categories={categories}
                onCategoryCreated={(c) =>
                  setCategories((prev) => [
                    ...prev,
                    {
                      id: c.id,
                      name: c.name,
                      default_country: c.default_country ?? null,
                      default_proxy_type: (c.default_proxy_type as ProxyType | null) ?? null,
                      default_isp: null,
                      default_network_type: null,
                      default_vendor_source: null,
                      default_purchase_price_usd: null,
                      default_sale_price_usd: null,
                    },
                  ])
                }
              />
              <p className="text-xs text-muted-foreground">
                Nếu chọn danh mục, các trường loại/quốc gia dưới sẽ tự fill từ default. Sửa nếu cần.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Loại proxy mặc định</Label>
              <Select value={proxyType} onValueChange={(v: string | null) => v && setProxyType(v as ProxyType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ProxyType.HTTP}>HTTP</SelectItem>
                  <SelectItem value={ProxyType.HTTPS}>HTTPS</SelectItem>
                  <SelectItem value={ProxyType.SOCKS5}>SOCKS5</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Auto-detect ưu tiên hơn — nếu probe ra loại khác, dùng loại detect.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="import-network-type">Phân loại</Label>
              <Input
                id="import-network-type"
                list="import-network-list"
                placeholder="ipv4 / ipv6 / isp / dung lượng..."
                value={networkType}
                onChange={(e) => setNetworkType(e.target.value)}
                maxLength={80}
              />
              <datalist id="import-network-list">
                {NETWORK_TYPE_SUGGESTIONS.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">
                Tự gõ giá trị mới nếu không có trong gợi ý.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="import-vendor">Nguồn</Label>
              <Input
                id="import-vendor"
                placeholder="VD: Proxy-Seller, Tự build"
                value={vendorSource}
                onChange={(e) => setVendorSource(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="import-country">Quốc gia</Label>
              <Input
                id="import-country"
                list="import-country-list"
                placeholder="VD: VN, US, JP"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
              <datalist id="import-country-list">
                {countries.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="import-purchase-date">Ngày mua *</Label>
              <Input
                id="import-purchase-date"
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="import-expires-at">Ngày hết hạn</Label>
              <Input
                id="import-expires-at"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Để trống = không giới hạn</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="import-purchase-price">Giá mua ($)</Label>
              <Input
                id="import-purchase-price"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="import-sale-price">Giá bán ($)</Label>
              <Input
                id="import-sale-price"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
              />
              {/* Wave 26-A — lo/lai warning. Pre-fix only showed lãi
                  when sale > purchase; if admin typo'd them swapped
                  (mua 5, bán 1) there was no signal. Now: gain green,
                  break-even neutral, loss amber. */}
              {purchasePrice && salePrice && (() => {
                const buy = Number(purchasePrice);
                const sell = Number(salePrice);
                if (!Number.isFinite(buy) || !Number.isFinite(sell)) return null;
                const diff = sell - buy;
                if (diff > 0) {
                  return (
                    <p className="text-xs text-emerald-500">
                      Lãi: ${diff.toFixed(2)}/proxy
                    </p>
                  );
                }
                if (diff < 0) {
                  return (
                    <p className="text-xs text-amber-600">
                      [!] Bán &lt; mua — lỗ ${Math.abs(diff).toFixed(2)}/proxy. Kiểm tra lại?
                    </p>
                  );
                }
                return (
                  <p className="text-xs text-muted-foreground">
                    Hoà vốn (chưa có lãi).
                  </p>
                );
              })()}
            </div>
            {/* Wave 22AB — ISP input removed (column dropped from UI in Wave 22Y) */}
          </div>

          <div className="space-y-2">
            <Label htmlFor="import-notes">Ghi chú</Label>
            <Textarea
              id="import-notes"
              placeholder="Áp dụng cho mọi proxy được import (tuỳ chọn)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Step 2: Probe + Preview */}
      {parsedProxies.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>2. Xem trước & auto-detect ({parsedProxies.length} dòng)</CardTitle>
                <CardDescription>
                  <span className="text-emerald-500">{validCount} hợp lệ</span>
                  {invalidCount > 0 && (
                    <> {" / "}<span className="text-red-500">{invalidCount} lỗi</span></>
                  )}
                  {probedCount > 0 && (
                    <> {" · đã probe "}{probedCount} — <span className="text-emerald-500">{aliveCount} alive</span> / <span className="text-red-500">{deadCount} dead</span></>
                  )}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={handleProbe} disabled={probing || importing || validCount === 0}>
                  {probing ? (
                    <><Loader2 className="size-4 mr-1.5 animate-spin" />Đang probe ({probeProgress}%)</>
                  ) : (
                    <><Radar className="size-4 mr-1.5" />Auto-detect loại + alive</>
                  )}
                </Button>
                <Button onClick={handleImport} disabled={importing || probing || validCount === 0}>
                  {importing ? (
                    <><Loader2 className="size-4 mr-1.5 animate-spin" />Đang import...</>
                  ) : (
                    <><Upload className="size-4 mr-1.5" />Import {dropDead && probedCount > 0 ? aliveCount : validCount}</>
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Wave 26-A — "Sẽ áp dụng cho tất cả" banner. User report
                2026-05-03: "cột nguồn và tất cả các cột khác khi thêm
                vào có điền ở trên thì ở dưới preview cần hiện đầy đủ".
                Pre-fix the form fields at the top (country, vendor,
                phân loại, dates, prices, notes) didn't appear anywhere
                in the preview — admin had to scroll back up to verify.
                Now: a compact summary card lists every non-empty bulk
                field so admin sees AT A GLANCE what will be applied to
                all {validCount} rows. */}
            {(() => {
              const selectedCategory = categories.find((c) => c.id === categoryId);
              const bulkRows: Array<{ label: string; value: React.ReactNode }> = [];
              if (selectedCategory) {
                bulkRows.push({
                  label: "Danh mục",
                  value: <span className="font-medium">{selectedCategory.name}</span>,
                });
              }
              bulkRows.push({
                label: "Loại proxy mặc định",
                value: <span className="font-mono">{proxyType.toUpperCase()}</span>,
              });
              if (networkType) bulkRows.push({ label: "Phân loại", value: <span className="font-mono">{networkType}</span> });
              if (vendorSource) bulkRows.push({ label: "Nguồn", value: <span className="font-mono">{vendorSource}</span> });
              if (country) bulkRows.push({ label: "Quốc gia", value: <span className="font-mono">{country}</span> });
              if (purchaseDate) bulkRows.push({ label: "Ngày mua", value: <span className="font-mono">{purchaseDate}</span> });
              if (expiresAt) bulkRows.push({ label: "Ngày hết hạn", value: <span className="font-mono">{expiresAt}</span> });
              if (purchasePrice) bulkRows.push({ label: "Giá mua", value: <span className="font-mono">${purchasePrice}</span> });
              if (salePrice) bulkRows.push({ label: "Giá bán", value: <span className="font-mono">${salePrice}</span> });
              return (
                <div className="mb-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-primary">
                    Sẽ áp dụng cho TẤT CẢ {validCount} proxy hợp lệ
                  </p>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2 md:grid-cols-3">
                    {bulkRows.map((r) => (
                      <div key={r.label} className="flex gap-2">
                        <span className="text-muted-foreground">{r.label}:</span>
                        {r.value}
                      </div>
                    ))}
                  </div>
                  {notes && (
                    <p className="mt-2 border-t border-primary/20 pt-2 text-xs">
                      <span className="text-muted-foreground">Ghi chú:</span>{" "}
                      <span className="italic">{notes}</span>
                    </p>
                  )}
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Auto-detect (nếu probe) sẽ override <span className="font-mono">Loại proxy mặc định</span> per-row.
                  </p>
                </div>
              );
            })()}

            {/* Probe summary */}
            {probedCount > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border bg-muted/20 p-3 text-sm">
                <span className="font-medium">Đã detect:</span>
                {Object.entries(probedSummary).map(([t, n]) => (
                  <Badge key={t} variant="outline" className="font-mono">
                    {t.toUpperCase()}: {n}
                  </Badge>
                ))}
                {deadCount > 0 && (
                  <>
                    <Badge variant="destructive" className="ml-auto">{deadCount} dead</Badge>
                    <label className="flex items-center gap-1.5 text-xs">
                      <input type="checkbox" checked={dropDead} onChange={(e) => setDropDead(e.target.checked)} />
                      Bỏ qua proxy chết khi import
                    </label>
                  </>
                )}
              </div>
            )}

            {/* Wave 23B-fix — preview legend bar. Pre-fix the table had
                7 columns with terse headers and no explanation of what
                "-" meant. User feedback: "cần mô tả rõ ở phần xem
                trước có những cột gì và cột gì trống".
                Wave 26-A — drop the "không auth" entry until user/pass
                actually appears blank in any row, and only mention
                "dead" semantics when the user has actually probed
                (otherwise the legend describes columns the table
                doesn't even render). */}
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Chú giải:</span>
              <span className="flex items-center gap-1">
                <span className="font-mono text-amber-600">—</span>
                <span>không auth (user/pass trống — proxy public)</span>
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle className="size-3 text-emerald-500" />
                <span>hợp lệ{probedCount > 0 ? " / alive" : ""}</span>
              </span>
              <span className="flex items-center gap-1">
                <XCircle className="size-3 text-red-500" />
                <span>format lỗi (dòng đỏ, không import)</span>
              </span>
              {probedCount > 0 && (
                <span className="flex items-center gap-1">
                  <AlertCircle className="size-3 text-red-500" />
                  <span>dead (mờ, sẽ bị bỏ nếu bật &quot;Bỏ qua proxy chết&quot;)</span>
                </span>
              )}
            </div>

            <div className="max-h-[400px] overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12" title="Số thứ tự dòng trong input">#</TableHead>
                    <TableHead title="Địa chỉ IP/host của proxy (bắt buộc)">Host</TableHead>
                    <TableHead className="w-20" title="Cổng (1-65535, bắt buộc)">Cổng</TableHead>
                    <TableHead className="w-32" title="Tên đăng nhập của proxy (có thể trống nếu proxy public)">User</TableHead>
                    <TableHead className="w-24" title="Mật khẩu (đi kèm User)">Pass</TableHead>
                    {/* Wave 26-A — "Loại detect" + "Tốc độ" only render
                        AFTER the user clicks Auto-detect. Pre-fix two
                        empty "—" columns took table width before any
                        probe ran (user feedback: "tốc độ lúc thêm vào
                        chưa quét được thì không cần có trong preview"). */}
                    {probedCount > 0 && (
                      <>
                        <TableHead className="w-24" title="Loại proxy detect được sau khi probe (HTTP/HTTPS/SOCKS5)">Loại detect</TableHead>
                        <TableHead className="w-20" title="Thời gian phản hồi từ probe (ms)">Tốc độ</TableHead>
                      </>
                    )}
                    <TableHead className="w-32" title="Trạng thái dòng: hợp lệ / lỗi format / alive / dead">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedProxies.slice(0, 200).map((proxy) => {
                    // Wave 23B-fix — visual row state cues:
                    //   invalid format → red-tinted bg
                    //   dead probe    → opacity-50 (existing)
                    //   missing auth  → no extra cue (legitimate scenario)
                    const rowClass = !proxy.valid
                      ? "bg-red-50 dark:bg-red-950/20"
                      : proxy.alive === false
                        ? "opacity-50"
                        : "";
                    return (
                      <TableRow key={proxy.line} className={rowClass}>
                        <TableCell className="text-muted-foreground">{proxy.line}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {proxy.host || <span className="text-red-500">— thiếu host</span>}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {proxy.port || <span className="text-red-500">—</span>}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {proxy.username ? (
                            <span>{proxy.username}</span>
                          ) : (
                            <span className="text-amber-600" title="Proxy không có auth — public proxy">—</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {proxy.password ? (
                            <span className="text-muted-foreground">••••••</span>
                          ) : (
                            <span className="text-amber-600" title="Không có pass">—</span>
                          )}
                        </TableCell>
                        {/* Wave 26-A — match the conditional header
                            above. Cells only render when probe ran. */}
                        {probedCount > 0 && (
                          <>
                            <TableCell className="font-mono text-xs">
                              {proxy.detected_type ? (
                                <Badge variant="outline" className="text-xs">{proxy.detected_type.toUpperCase()}</Badge>
                              ) : (
                                <span className="text-muted-foreground" title="Chưa probe được">—</span>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {proxy.speed_ms != null ? (
                                `${proxy.speed_ms}ms`
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </>
                        )}
                        <TableCell>
                          {!proxy.valid ? (
                            <span className="flex items-center gap-1 text-red-500 text-xs" title={proxy.error}>
                              <XCircle className="size-3.5" />{proxy.error}
                            </span>
                          ) : proxy.alive === false ? (
                            <span className="flex items-center gap-1 text-red-500 text-xs">
                              <AlertCircle className="size-3.5" />Dead
                            </span>
                          ) : proxy.alive === true ? (
                            <span className="flex items-center gap-1 text-emerald-500 text-xs">
                              <CheckCircle className="size-3.5" />Alive
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-emerald-500 text-xs">
                              <CheckCircle className="size-3.5" />Hợp lệ
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {parsedProxies.length > 200 && (
                <p className="border-t bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  Đang hiển thị 200/{parsedProxies.length} dòng. Tất cả sẽ được import / probe.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Result */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle>3. Kết quả import</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-emerald-500">{result.imported}</p>
                <p className="text-sm text-muted-foreground">Đã import</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-yellow-500">{result.skipped}</p>
                <p className="text-sm text-muted-foreground">Bỏ qua (trùng)</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-500">{result.failed}</p>
                <p className="text-sm text-muted-foreground">Lỗi</p>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="mt-4 space-y-1">
                <p className="text-sm font-medium">Lỗi chi tiết:</p>
                {result.errors.slice(0, 20).map((err, i) => (
                  <p key={i} className="text-xs text-red-400">Dòng {err.line}: {err.reason}</p>
                ))}
                {result.errors.length > 20 && (
                  <p className="text-xs text-muted-foreground">... và {result.errors.length - 20} lỗi khác</p>
                )}
              </div>
            )}
            {/* Wave 26-A — next-action CTAs. Pre-fix admin had to
                navigate sidebar manually after import. Two buttons:
                  - primary: jump to the proxies list (with success
                    toast already fired earlier)
                  - secondary: "Import thêm" — keeps the user on this
                    page, the form was already cleared in handleImport. */}
            <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t pt-4">
              <Link href="/proxies" className={buttonVariants()}>
                Xem danh sách proxy
              </Link>
              <Button variant="outline" onClick={() => setResult(null)}>
                Import thêm
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
