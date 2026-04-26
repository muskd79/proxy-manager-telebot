"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, RefreshCw, Upload } from "lucide-react";
import type { PurchaseLot } from "@/types/database";

interface LotRow extends PurchaseLot {}

export default function LotsPage() {
  const [rows, setRows] = useState<LotRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/lots?limit=100", { cache: "no-store" });
      const body = await res.json();
      if (!body.success) {
        toast.error(body.error ?? "Failed to load lots");
        return;
      }
      setRows(body.data as LotRow[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase lots</h1>
          <p className="text-sm text-muted-foreground">
            One lot = one CSV/manual purchase from a vendor portal. Tracks cost,
            expiry, and batch reference for renewal alerts.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : undefined} />
            Refresh
          </Button>
          <Link href="/lots/import">
            <Button size="sm">
              <Plus />
              Import lot
            </Button>
          </Link>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Purchased</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Proxies</TableHead>
                <TableHead className="text-right">Total cost</TableHead>
                <TableHead>Batch ref</TableHead>
                <TableHead className="text-right">Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{r.vendor_label}</div>
                    {r.notes && (
                      <div className="text-xs text-muted-foreground line-clamp-1">{r.notes}</div>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {new Date(r.purchase_date).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <ExpiryBadge isoDate={r.expiry_date} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.proxy_count}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {r.total_cost_usd != null
                      ? `${r.currency} ${r.total_cost_usd.toFixed(2)}`
                      : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.batch_reference ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/proxies?lot_id=${r.id}`}
                      className="text-sm underline-offset-4 hover:underline"
                    >
                      View proxies
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ExpiryBadge({ isoDate }: { isoDate: string | null }) {
  if (!isoDate) return <span className="text-xs text-muted-foreground">—</span>;
  const exp = new Date(isoDate).getTime();
  const now = Date.now();
  const hoursLeft = (exp - now) / (1000 * 60 * 60);

  if (hoursLeft < 0) {
    return <Badge variant="destructive">Expired</Badge>;
  }
  if (hoursLeft < 24) {
    return <Badge variant="destructive">{Math.round(hoursLeft)}h left</Badge>;
  }
  if (hoursLeft < 24 * 7) {
    return <Badge variant="secondary">{Math.round(hoursLeft / 24)}d left</Badge>;
  }
  return (
    <span className="font-mono text-xs">{new Date(isoDate).toLocaleDateString()}</span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <h3 className="text-lg font-semibold">No lots yet</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Click &ldquo;Import lot&rdquo; to record your first purchase. Each CSV upload
        becomes one lot with cost, expiry, and vendor metadata.
      </p>
      <Link href="/lots/import" className="inline-block mt-3">
        <Button>
          <Upload />
          Import your first lot
        </Button>
      </Link>
    </div>
  );
}
