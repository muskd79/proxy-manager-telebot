"use client";

import { useState, useCallback, useEffect } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import { ProxyType } from "@/types/database";
import type { ImportProxyResult } from "@/types/api";

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
  const [isp, setIsp] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
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
    if (cat.default_isp) setIsp(cat.default_isp);
    if (cat.default_network_type) setNetworkType(cat.default_network_type);
    if (cat.default_vendor_source) setVendorSource(cat.default_vendor_source);
    if (cat.default_purchase_price_usd != null)
      setPurchasePrice(String(cat.default_purchase_price_usd));
    if (cat.default_sale_price_usd != null)
      setSalePrice(String(cat.default_sale_price_usd));
  }, [categoryId, categories]);

  function parseProxyLine(line: string, lineNum: number): ParsedProxy {
    const trimmed = line.trim();
    if (!trimmed) {
      return { line: lineNum, raw: line, host: "", port: 0, valid: false, error: "Empty line" };
    }
    const parts = trimmed.split(/[:\t,;]/);
    if (parts.length < 2) {
      return { line: lineNum, raw: trimmed, host: "", port: 0, valid: false, error: "Invalid format (expected host:port)" };
    }
    const host = parts[0].trim();
    const port = parseInt(parts[1].trim());
    const username = parts[2]?.trim() || undefined;
    const password = parts[3]?.trim() || undefined;
    if (!host) return { line: lineNum, raw: trimmed, host: "", port: 0, valid: false, error: "Missing host" };
    if (isNaN(port) || port < 1 || port > 65535) {
      return { line: lineNum, raw: trimmed, host, port: 0, valid: false, error: "Invalid port" };
    }
    return { line: lineNum, raw: trimmed, host, port, username, password, valid: true };
  }

  function parseContent(content: string) {
    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    const parsed = lines.map((line, i) => parseProxyLine(line, i + 1));
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
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <Upload className="size-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-3">Kéo thả file vào đây, hoặc click để chọn</p>
            <Input type="file" accept=".txt,.csv" onChange={handleFileChange} className="max-w-xs mx-auto" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Danh mục</Label>
              <Select
                value={categoryId || "_none"}
                onValueChange={(v: string | null) => setCategoryId(v === "_none" ? "" : v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Không phân loại" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Không phân loại</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.default_proxy_type ? ` · ${c.default_proxy_type.toUpperCase()}` : ""}
                      {c.default_country ? ` · ${c.default_country}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Nếu chọn danh mục, các trường loại/quốc gia/ISP dưới sẽ tự fill từ default. Sửa nếu cần.
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
              {purchasePrice && salePrice && Number(salePrice) > Number(purchasePrice) && (
                <p className="text-xs text-emerald-500">
                  Lãi: ${(Number(salePrice) - Number(purchasePrice)).toFixed(2)}/proxy
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="import-isp">ISP (nhà mạng)</Label>
              <Input
                id="import-isp"
                placeholder="VD: Viettel, AWS"
                value={isp}
                onChange={(e) => setIsp(e.target.value)}
              />
            </div>
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

            <div className="max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Host</TableHead>
                    <TableHead className="w-20">Port</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead className="w-24">Loại detect</TableHead>
                    <TableHead className="w-20">Tốc độ</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedProxies.slice(0, 200).map((proxy) => (
                    <TableRow key={proxy.line} className={proxy.alive === false ? "opacity-50" : undefined}>
                      <TableCell className="text-muted-foreground">{proxy.line}</TableCell>
                      <TableCell className="font-mono text-xs">{proxy.host || "-"}</TableCell>
                      <TableCell className="font-mono text-xs">{proxy.port || "-"}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{proxy.username || "-"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {proxy.detected_type ? (
                          <Badge variant="outline" className="text-xs">{proxy.detected_type.toUpperCase()}</Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {proxy.speed_ms != null ? `${proxy.speed_ms}ms` : "-"}
                      </TableCell>
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
                  ))}
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
