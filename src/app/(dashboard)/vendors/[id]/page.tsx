"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { RefreshCw, ShoppingCart, FileText } from "lucide-react";
import { BuyVendorModal } from "@/components/vendors/buy/BuyVendorModal";

interface VendorMeta {
  id: string;
  slug: string;
  display_name: string;
  status: "active" | "paused" | "deprecated";
}

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
  const router = useRouter();
  const [vendor, setVendor] = useState<VendorMeta | null>(null);
  const [products, setProducts] = useState<VendorProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [productsRes, vendorRes] = await Promise.all([
        fetch(`/api/vendors/${id}/products`, { cache: "no-store" }),
        fetch(`/api/vendors`, { cache: "no-store" }),
      ]);
      const productsBody = await productsRes.json();
      const vendorBody = await vendorRes.json();

      if (!productsBody.success) {
        toast.error(productsBody.error ?? "Failed to load products");
      } else {
        setProducts(productsBody.data as VendorProduct[]);
      }
      if (vendorBody.success) {
        const v = (vendorBody.data.vendors as VendorMeta[]).find((x) => x.id === id);
        setVendor(v ?? null);
      }
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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {vendor?.display_name ?? "Vendor catalog"}
          </h1>
          {vendor && (
            <div className="mt-1 flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">slug:</span>
              <code className="text-xs">{vendor.slug}</code>
              <Badge
                variant={vendor.status === "active" ? "default" : "secondary"}
                className="ml-2"
              >
                {vendor.status}
              </Badge>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Link href={`/vendors/${id}/orders`}>
            <Button variant="outline" size="sm">
              <FileText />
              Orders
            </Button>
          </Link>
          <Button
            variant="default"
            size="sm"
            onClick={() => setBuyOpen(true)}
            disabled={!vendor || vendor.status !== "active" || products.length === 0}
            title={
              !vendor || vendor.status !== "active"
                ? "Vendor must be active"
                : products.length === 0
                  ? "Sync the catalog first"
                  : undefined
            }
          >
            <ShoppingCart />
            Buy now
          </Button>
          <Button variant="outline" size="sm" onClick={syncCatalog} disabled={syncing}>
            <RefreshCw className={syncing ? "animate-spin" : undefined} />
            Sync
          </Button>
        </div>
      </div>

      {vendor && (
        <BuyVendorModal
          vendorId={vendor.id}
          vendorSlug={vendor.slug}
          vendorStatus={vendor.status}
          open={buyOpen}
          onOpenChange={setBuyOpen}
          onOrderCreated={(orderId) => router.push(`/vendors/${id}/orders`)}
        />
      )}

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
