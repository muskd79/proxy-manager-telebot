"use client";

import { use, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw } from "lucide-react";

interface VendorProduct {
  id: string;
  vendor_sku: string;
  name: string;
  type: "residential" | "datacenter" | "mobile" | "isp";
  country: string[];
  bandwidth_gb: number | null;
  concurrent_threads: number | null;
  unit_price_usd: number;
  billing_cycle: "one_off" | "daily" | "weekly" | "monthly";
  last_synced_at: string;
}

export default function VendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [products, setProducts] = useState<VendorProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/vendors/${id}/products`, { cache: "no-store" });
      const body = await res.json();
      if (!body.success) {
        toast.error(body.error ?? "Failed to load products");
        return;
      }
      setProducts(body.data as VendorProduct[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const syncCatalog = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/vendors/${id}/products`, { method: "POST" });
      const body = await res.json();
      if (!body.success) {
        toast.error(body.error ?? "Sync failed");
        return;
      }
      toast.success(`Synced ${body.data.synced} products`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Vendor catalog</h1>
        <Button size="sm" onClick={syncCatalog} disabled={syncing}>
          <RefreshCw className={syncing ? "animate-spin" : undefined} />
          Sync from vendor
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : products.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <h3 className="text-lg font-semibold">No products synced yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Click &ldquo;Sync from vendor&rdquo; to pull the live catalog. Vendor must have
            a primary credential configured (migration 020 / vendor_credentials).
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Countries</TableHead>
                <TableHead>Bandwidth</TableHead>
                <TableHead>Cycle</TableHead>
                <TableHead className="text-right">Unit $</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{p.vendor_sku}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{p.type}</Badge>
                  </TableCell>
                  <TableCell>
                    {p.country.length === 0 ? (
                      <span className="text-xs text-muted-foreground">global</span>
                    ) : p.country.length <= 3 ? (
                      <span className="font-mono text-xs">{p.country.join(", ")}</span>
                    ) : (
                      <span className="font-mono text-xs">
                        {p.country.slice(0, 3).join(", ")} +{p.country.length - 3}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.bandwidth_gb != null ? `${p.bandwidth_gb} GB` : "—"}
                  </TableCell>
                  <TableCell className="capitalize">{p.billing_cycle.replace("_", " ")}</TableCell>
                  <TableCell className="text-right font-mono">
                    ${p.unit_price_usd.toFixed(4)}
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
