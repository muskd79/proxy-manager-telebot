"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { uuidv7 } from "@/lib/uuid7";
import { Loader2, ShoppingCart } from "lucide-react";

interface VendorProductLite {
  id: string;
  vendor_sku: string;
  name: string;
  type: string;
  bandwidth_gb: number | null;
  unit_price_usd: number;
  billing_cycle: string;
}

interface BuyVendorModalProps {
  vendorId: string;
  vendorSlug: string;
  vendorStatus: "active" | "paused" | "deprecated";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful order is created — caller refetches the list. */
  onOrderCreated: (orderId: string) => void;
}

/**
 * Buy modal for tier-1 (full-API) vendors. Generates a UUIDv7 idempotency
 * key on mount so re-opening the modal does NOT reuse a previous key
 * (each modal session = one logical order).
 *
 * The submit button is disabled when:
 *   - no product is selected
 *   - quantity is invalid
 *   - vendor is not active
 *   - request is in flight (prevents double-click double-charge)
 */
export function BuyVendorModal({
  vendorId,
  vendorSlug,
  vendorStatus,
  open,
  onOpenChange,
  onOrderCreated,
}: BuyVendorModalProps) {
  const [products, setProducts] = useState<VendorProductLite[]>([]);
  const [productId, setProductId] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");

  // Generate a fresh UUIDv7 every time the modal opens.
  useEffect(() => {
    if (open) {
      setIdempotencyKey(uuidv7());
      setQuantity(1);
      setProductId("");
    }
  }, [open]);

  // Load product catalog when modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/vendors/${vendorId}/products`, {
          cache: "no-store",
        });
        const body = await res.json();
        if (cancelled) return;
        if (!body.success) {
          toast.error(body.error ?? "Failed to load catalog");
          setProducts([]);
          return;
        }
        setProducts(body.data as VendorProductLite[]);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Network error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, vendorId]);

  const selected = useMemo(
    () => products.find((p) => p.id === productId) ?? null,
    [products, productId],
  );
  const totalCost = useMemo(
    () => (selected ? Number((selected.unit_price_usd * quantity).toFixed(4)) : 0),
    [selected, quantity],
  );

  const canSubmit =
    !submitting &&
    selected !== null &&
    quantity >= 1 &&
    quantity <= 1000 &&
    vendorStatus === "active" &&
    !!idempotencyKey;

  async function submit() {
    if (!selected) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/vendors/${vendorId}/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vendor_product_id: selected.id,
          quantity,
          idempotency_key: idempotencyKey,
        }),
      });
      const body = await res.json();
      if (!body.success) {
        toast.error(body.error ?? `Failed (${res.status})`);
        return;
      }
      toast.success(
        body.data?.deduplicated
          ? "Order already submitted (idempotent retry)."
          : "Order queued. Saga will fulfill within ~60s.",
      );
      onOrderCreated(body.data.id as string);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Buy from {vendorSlug}</DialogTitle>
          <DialogDescription>
            Order is queued in {`vendor_orders`} as <code>pending</code>; the
            outbox-drain reconciler picks it up and calls the vendor API.
          </DialogDescription>
        </DialogHeader>

        {vendorStatus !== "active" ? (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            Vendor is <strong>{vendorStatus}</strong>. Activate it (and ensure a
            primary credential is configured) before buying.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="product">Product</Label>
              <Select
                value={productId}
                onValueChange={(v) => setProductId(v ?? "")}
                disabled={loading}
              >
                <SelectTrigger id="product">
                  <SelectValue
                    placeholder={
                      loading ? "Loading…" : products.length === 0 ? "No products synced" : "Select a product"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="font-medium">{p.name}</span>
                      <span className="ml-2 text-muted-foreground">
                        ${p.unit_price_usd.toFixed(4)} / {p.billing_cycle}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="qty">Quantity</Label>
              <Input
                id="qty"
                type="number"
                min={1}
                max={1000}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
              />
            </div>

            {selected && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Unit price</span>
                  <span className="font-mono">${selected.unit_price_usd.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Quantity</span>
                  <span className="font-mono">{quantity}</span>
                </div>
                <div className="flex justify-between border-t pt-1">
                  <span>Total</span>
                  <span className="font-mono font-semibold">${totalCost.toFixed(4)}</span>
                </div>
                <div className="pt-2 text-xs text-muted-foreground">
                  Idempotency key: <code className="text-[10px]">{idempotencyKey}</code>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting ? <Loader2 className="animate-spin" /> : <ShoppingCart />}
            {submitting ? "Submitting…" : "Confirm purchase"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
