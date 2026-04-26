"use client";

import { use, useCallback, useEffect, useState } from "react";
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

interface VendorOrderRow {
  id: string;
  idempotency_key: string;
  vendor_product_id: string | null;
  quantity: number;
  unit_cost_usd: number;
  total_cost_usd: number;
  status:
    | "pending"
    | "processing"
    | "fulfilled"
    | "failed"
    | "cancelled"
    | "refunded";
  failure_category: string | null;
  last_error: string | null;
  attempt_count: number;
  vendor_order_ref: string | null;
  dlq_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_VARIANT: Record<VendorOrderRow["status"], "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  processing: "default",
  fulfilled: "default",
  failed: "destructive",
  cancelled: "outline",
  refunded: "outline",
};

export default function VendorOrdersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: vendorId } = use(params);
  const [rows, setRows] = useState<VendorOrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/vendors/${vendorId}/orders?limit=100`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!body.success) {
        toast.error(body.error ?? "Failed to load orders");
        return;
      }
      setRows(body.data as VendorOrderRow[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [vendorId]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: subscribe to changes on this vendor's orders so the saga
  // transitions show up immediately without polling.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const channel = supabase
        .channel(`vendor_orders_${vendorId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "vendor_orders",
            filter: `vendor_id=eq.${vendorId}`,
          },
          () => {
            if (!cancelled) load();
          },
        )
        .subscribe();
      unsubscribe = () => {
        supabase.removeChannel(channel);
      };
    })();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [vendorId, load]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vendor orders</h1>
          <p className="text-sm text-muted-foreground">
            Orders feed the saga drain. Realtime subscription updates the status
            column as the reconciler progresses.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <h3 className="text-lg font-semibold">No orders yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Click <strong>Buy now</strong> on the vendor page to create one.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Vendor ref</TableHead>
                <TableHead>Last error</TableHead>
                <TableHead className="text-right">View</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">
                    {new Date(r.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                    {r.dlq_at && (
                      <Badge variant="destructive" className="ml-2">DLQ</Badge>
                    )}
                  </TableCell>
                  <TableCell>{r.quantity}</TableCell>
                  <TableCell className="font-mono">
                    ${r.total_cost_usd.toFixed(4)}
                  </TableCell>
                  <TableCell>{r.attempt_count}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.vendor_order_ref ?? "—"}
                  </TableCell>
                  <TableCell
                    className="max-w-[260px] truncate text-xs text-muted-foreground"
                    title={r.last_error ?? ""}
                  >
                    {r.last_error ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/vendors/orders/${r.id}`}
                      className="text-sm underline-offset-4 hover:underline"
                    >
                      Details
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
