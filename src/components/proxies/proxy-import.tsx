"use client";

import { useState, useCallback } from "react";
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
import { Upload, FileText, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ProxyType } from "@/types/database";
import type { ImportProxyResult } from "@/types/api";

interface ParsedProxy {
  line: number;
  raw: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  valid: boolean;
  error?: string;
}

export function ProxyImport() {
  const [parsedProxies, setParsedProxies] = useState<ParsedProxy[]>([]);
  const [proxyType, setProxyType] = useState<ProxyType>(ProxyType.HTTP);
  const [country, setCountry] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportProxyResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function parseProxyLine(line: string, lineNum: number): ParsedProxy {
    const trimmed = line.trim();
    if (!trimmed) {
      return {
        line: lineNum,
        raw: line,
        host: "",
        port: 0,
        valid: false,
        error: "Empty line",
      };
    }

    const parts = trimmed.split(/[:\t,;]/);

    if (parts.length < 2) {
      return {
        line: lineNum,
        raw: trimmed,
        host: "",
        port: 0,
        valid: false,
        error: "Invalid format (expected host:port)",
      };
    }

    const host = parts[0].trim();
    const port = parseInt(parts[1].trim());
    const username = parts[2]?.trim() || undefined;
    const password = parts[3]?.trim() || undefined;

    if (!host) {
      return {
        line: lineNum,
        raw: trimmed,
        host: "",
        port: 0,
        valid: false,
        error: "Missing host",
      };
    }

    if (isNaN(port) || port < 1 || port > 65535) {
      return {
        line: lineNum,
        raw: trimmed,
        host,
        port: 0,
        valid: false,
        error: "Invalid port",
      };
    }

    return { line: lineNum, raw: trimmed, host, port, username, password, valid: true };
  }

  function parseContent(content: string) {
    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    const parsed = lines.map((line, i) => parseProxyLine(line, i + 1));
    setParsedProxies(parsed);
    setResult(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      parseContent(text);
    };
    reader.readAsText(file);
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      parseContent(text);
    };
    reader.readAsText(file);
  }, []);

  async function handleImport() {
    const validProxies = parsedProxies
      .filter((p) => p.valid)
      .map((p) => ({
        host: p.host,
        port: p.port,
        username: p.username,
        password: p.password,
        line: p.line,
        raw: p.raw,
      }));

    if (validProxies.length === 0) return;

    setImporting(true);
    try {
      const res = await fetch("/api/proxies/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proxies: validProxies,
          type: proxyType,
          country: country || undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setResult(data.data);
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

  return (
    <div className="space-y-6">
      {/* Upload Area */}
      <Card>
        <CardHeader>
          <CardTitle>Upload Proxies</CardTitle>
          <CardDescription>
            Supported formats: TXT (host:port:user:pass per line), CSV
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <Upload className="size-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-3">
              Drag and drop a file here, or click to select
            </p>
            <Input
              type="file"
              accept=".txt,.csv"
              onChange={handleFileChange}
              className="max-w-xs mx-auto"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Proxy Type</Label>
              <Select
                value={proxyType}
                onValueChange={(val: string | null) => { if (val) setProxyType(val as ProxyType); }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ProxyType.HTTP}>HTTP</SelectItem>
                  <SelectItem value={ProxyType.HTTPS}>HTTPS</SelectItem>
                  <SelectItem value={ProxyType.SOCKS5}>SOCKS5</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="import-country">Country</Label>
              <Input
                id="import-country"
                placeholder="e.g. US"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      {parsedProxies.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Preview ({parsedProxies.length} lines)</CardTitle>
                <CardDescription>
                  <span className="text-emerald-500">{validCount} valid</span>
                  {invalidCount > 0 && (
                    <>
                      {" / "}
                      <span className="text-red-500">
                        {invalidCount} invalid
                      </span>
                    </>
                  )}
                </CardDescription>
              </div>
              <Button
                onClick={handleImport}
                disabled={importing || validCount === 0}
              >
                {importing ? (
                  <>
                    <Loader2 className="size-4 mr-1.5 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="size-4 mr-1.5" />
                    Import {validCount} Proxies
                  </>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">#</TableHead>
                    <TableHead>Host</TableHead>
                    <TableHead>Port</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedProxies.map((proxy) => (
                    <TableRow key={proxy.line}>
                      <TableCell className="text-muted-foreground">
                        {proxy.line}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {proxy.host || "-"}
                      </TableCell>
                      <TableCell>{proxy.port || "-"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {proxy.username || "-"}
                      </TableCell>
                      <TableCell>
                        {proxy.valid ? (
                          <span className="flex items-center gap-1 text-emerald-500 text-sm">
                            <CheckCircle className="size-3.5" />
                            Valid
                          </span>
                        ) : (
                          <span
                            className="flex items-center gap-1 text-red-500 text-sm"
                            title={proxy.error}
                          >
                            <XCircle className="size-3.5" />
                            {proxy.error}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Result */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Import Result</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-emerald-500">
                  {result.imported}
                </p>
                <p className="text-sm text-muted-foreground">Imported</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-yellow-500">
                  {result.skipped}
                </p>
                <p className="text-sm text-muted-foreground">Skipped</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-500">
                  {result.failed}
                </p>
                <p className="text-sm text-muted-foreground">Failed</p>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="mt-4 space-y-1">
                <p className="text-sm font-medium">Errors:</p>
                {result.errors.map((err, i) => (
                  <p key={i} className="text-xs text-red-400">
                    Line {err.line}: {err.reason}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
