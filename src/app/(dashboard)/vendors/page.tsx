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
import { RefreshCw } from "lucide-react";

interface VendorRow {
  id: string;
  slug: string;
  display_name: string;
  status: "active" | "paused" | "deprecated";
  base_url: string;
  adapter_key: string;
  default_currency: string;
  rate_limit_rpm: number;
  notes: string | null;
  created_at: string;
}

interface VendorsApiResponse {
  success: boolean;
  data?: {
    vendors: VendorRow[];
    availableAdapterKeys: string[];
  };
  error?: string;
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/vendors", { cache: "no-store" });
      const body = (await res.json()) as VendorsApiResponse;
      if (!body.success || !body.data) {
        toast.error(body.error ?? "Failed to load vendors");
        setVendors([]);
        return;
      }
      setVendors(body.data.vendors);
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vendors</h1>
          <p className="text-sm text-muted-foreground">
            External proxy providers we integrate with. Inventory from these vendors
            is routed to Telegram users when the owned pool is exhausted.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : vendors.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Adapter</TableHead>
                <TableHead>Rate limit (rpm)</TableHead>
                <TableHead className="text-right">Catalog</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendors.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    <div className="font-medium">{v.display_name}</div>
                    <div className="text-xs text-muted-foreground">{v.slug}</div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={v.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{v.adapter_key}</TableCell>
                  <TableCell>{v.rate_limit_rpm}</TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/vendors/${v.id}`}
                      className="text-sm font-medium underline-offset-4 hover:underline"
                    >
                      View products
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

function StatusBadge({ status }: { status: VendorRow["status"] }) {
  const map: Record<VendorRow["status"], { label: string; variant: "default" | "secondary" | "destructive" }> = {
    active: { label: "Active", variant: "default" },
    paused: { label: "Paused", variant: "secondary" },
    deprecated: { label: "Deprecated", variant: "destructive" },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <h3 className="text-lg font-semibold">No vendors configured</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Add a vendor row via API or the database seed. Once a primary credential
        is configured, products can be synced from the vendor catalog.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Registered adapters: <span className="font-mono">webshare, smartproxy, iproyal</span>
      </p>
    </div>
  );
}
