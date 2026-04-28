"use client";

/**
 * Wave 22V — /check-proxy
 *
 * Standalone tool for ad-hoc proxy connectivity checking. Sister to
 * /proxies/import (which checks AND imports). This route only checks —
 * useful for vetting a list before deciding whether to import, or
 * for re-checking suspect proxies that are already in inventory.
 *
 * Backend: reuses /api/proxies/probe-batch (Wave 22H). The endpoint
 * caps at 1000 entries, runs ~50 hosts in parallel, and is admin-
 * gated. We do NOT hit any external GeoIP service — all probes are
 * raw TCP from our server, so admin proxy IPs never leak.
 *
 * Parsing: accepts the same line formats as the import wizard:
 *   host:port
 *   host:port:user:pass
 *   host port           (whitespace also OK)
 * Lines that fail to parse become "Lỗi định dạng" rows in the result
 * table so the admin sees exactly which line was bad without losing
 * the row count alignment.
 *
 * UX: paste → click → result table. Sortable by alive/speed. Export
 * CSV for downstream reporting.
 */

import { useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Download,
  Eraser,
  Loader2,
  Play,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buildCsv } from "@/lib/csv";

interface ParsedRow {
  ref: string;
  raw: string;
  host: string;
  port: number;
  parseError?: string;
}

interface ProbeResult {
  ref?: string;
  host: string;
  port: number;
  alive: boolean;
  type: "http" | "https" | "socks5" | null;
  speed_ms: number;
  ssrf_blocked?: boolean;
}

interface BatchSummary {
  total: number;
  alive: number;
  dead: number;
  by_type: Record<"http" | "https" | "socks5", number>;
}

const MAX_LINES = 1000;

/**
 * Parse one line of pasted text into a ParsedRow.
 *
 * Accepts the formats:
 *   host:port
 *   host:port:user:pass
 *   host port
 *   host port user pass
 */
function parseLine(raw: string, idx: number): ParsedRow {
  const trimmed = raw.trim();
  const ref = String(idx + 1);
  if (!trimmed) {
    return { ref, raw, host: "", port: 0, parseError: "Dòng trống" };
  }
  // Split on : OR whitespace, take first 2 tokens.
  const tokens = trimmed.split(/[:\s]+/).filter(Boolean);
  if (tokens.length < 2) {
    return { ref, raw: trimmed, host: "", port: 0, parseError: "Thiếu port" };
  }
  const [host, portStr] = tokens;
  const port = Number(portStr);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ref, raw: trimmed, host, port: 0, parseError: "Port không hợp lệ" };
  }
  if (host.length > 253) {
    return { ref, raw: trimmed, host, port: 0, parseError: "Host quá dài" };
  }
  return { ref, raw: trimmed, host, port };
}

export default function CheckProxyPage() {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [parseErrors, setParseErrors] = useState<ParsedRow[]>([]);

  // Live count of pasted lines for UX feedback.
  const lineCount = useMemo(
    () => input.split("\n").filter((l) => l.trim().length > 0).length,
    [input],
  );

  const handleClear = () => {
    setInput("");
    setResults([]);
    setSummary(null);
    setParseErrors([]);
  };

  const handleCheck = async () => {
    const lines = input.split("\n");
    if (lines.length > MAX_LINES) {
      toast.error(`Tối đa ${MAX_LINES} dòng / lần check`);
      return;
    }
    const parsed = lines.map(parseLine);
    const valid = parsed.filter((p) => !p.parseError);
    const invalid = parsed.filter((p) => p.parseError && p.raw);
    if (valid.length === 0) {
      toast.error("Không có dòng hợp lệ để kiểm tra");
      setParseErrors(invalid);
      return;
    }

    setSubmitting(true);
    setParseErrors(invalid);
    setResults([]);
    setSummary(null);

    try {
      const res = await fetch("/api/proxies/probe-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proxies: valid.map((v) => ({ host: v.host, port: v.port, ref: v.ref })),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        toast.error(body.error || "Probe thất bại");
        return;
      }
      setResults(body.data?.results ?? []);
      setSummary(body.data?.summary ?? null);
      const aliveCount = body.data?.summary?.alive ?? 0;
      toast.success(`Đã kiểm tra ${valid.length} proxy — ${aliveCount} sống`);
    } catch (err) {
      console.error("Probe error:", err);
      toast.error("Lỗi kết nối khi kiểm tra");
    } finally {
      setSubmitting(false);
    }
  };

  const handleExport = () => {
    if (results.length === 0) return;
    const csv = buildCsv<ProbeResult>(results, [
      { header: "host", value: (r) => r.host },
      { header: "port", value: (r) => r.port },
      { header: "alive", value: (r) => (r.alive ? "1" : "0") },
      { header: "type", value: (r) => r.type ?? "" },
      { header: "speed_ms", value: (r) => r.speed_ms },
      { header: "ssrf_blocked", value: (r) => (r.ssrf_blocked ? "1" : "") },
    ]);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `proxy-check-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Activity className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Check proxy</h1>
          <p className="text-sm text-muted-foreground">
            Kiểm tra trực tiếp một danh sách proxy mà không cần import. Probe
            qua TCP nội bộ (không gọi GeoIP bên ngoài → không lộ IP).
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dán danh sách proxy</CardTitle>
          <CardDescription>
            Mỗi dòng 1 proxy. Định dạng:{" "}
            <code className="rounded bg-muted px-1 text-xs">host:port</code> hoặc{" "}
            <code className="rounded bg-muted px-1 text-xs">host:port:user:pass</code>.
            Tối đa {MAX_LINES} dòng.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={10}
            placeholder={`209.101.202.62:49155\n89.19.58.220:50100:cad2s12342:WZGqzAc5d6\n...`}
            className="font-mono text-sm"
            disabled={submitting}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleCheck} disabled={submitting || lineCount === 0}>
              {submitting ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-1.5 h-4 w-4" />
              )}
              Kiểm tra ({lineCount})
            </Button>
            <Button variant="outline" onClick={handleClear} disabled={submitting}>
              <Eraser className="mr-1.5 h-4 w-4" />
              Xoá
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              {lineCount} dòng · giới hạn {MAX_LINES} / lần
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Parse errors */}
      {parseErrors.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/40 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-amber-700" />
              {parseErrors.length} dòng không hợp lệ — bỏ qua
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs">
              {parseErrors.slice(0, 10).map((p) => (
                <li key={p.ref} className="font-mono">
                  <span className="text-muted-foreground">#{p.ref}</span>{" "}
                  <span className="line-through opacity-70">{p.raw}</span>{" "}
                  <span className="text-amber-700">— {p.parseError}</span>
                </li>
              ))}
              {parseErrors.length > 10 && (
                <li className="text-muted-foreground">
                  …và {parseErrors.length - 10} dòng khác
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard label="Tổng" value={summary.total} icon={Activity} />
          <SummaryCard
            label="Sống"
            value={summary.alive}
            icon={CheckCircle2}
            tone="success"
          />
          <SummaryCard
            label="Chết"
            value={summary.dead}
            icon={XCircle}
            tone="danger"
          />
          <SummaryCard
            label="Loại phát hiện"
            value={`${summary.by_type.http}H / ${summary.by_type.https}HS / ${summary.by_type.socks5}S5`}
            icon={Clock}
          />
        </div>
      )}

      {/* Result table */}
      {results.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Kết quả kiểm tra</CardTitle>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="mr-1.5 h-4 w-4" />
              Xuất CSV
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Host:Port</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead>Loại</TableHead>
                    <TableHead className="text-right">Tốc độ (ms)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r, i) => (
                    <TableRow key={`${r.host}:${r.port}:${i}`}>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.ref ?? i + 1}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.host}:{r.port}
                      </TableCell>
                      <TableCell>
                        {r.ssrf_blocked ? (
                          <Badge variant="destructive" className="gap-1">
                            <ShieldAlert className="h-3 w-3" />
                            SSRF chặn
                          </Badge>
                        ) : r.alive ? (
                          <Badge variant="default" className="gap-1 bg-emerald-600">
                            <CheckCircle2 className="h-3 w-3" />
                            Sống
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1">
                            <XCircle className="h-3 w-3" />
                            Chết
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.type ? (
                          <Badge variant="outline" className="uppercase">
                            {r.type}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {r.alive ? r.speed_ms : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "success" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-emerald-600"
      : tone === "danger"
        ? "text-rose-600"
        : "text-foreground";
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <Icon className={`h-5 w-5 ${toneClass}`} />
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-lg font-semibold ${toneClass}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
