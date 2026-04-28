"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Upload } from "lucide-react";
import type { WizardApi } from "@/components/lots/import/useImportWizard";

interface Step3MetadataProps {
  w: WizardApi;
  validCount: number;
}

export function Step3Metadata({ w, validCount }: Step3MetadataProps) {
  const m = w.state.metadata;
  const canSubmit = m.vendor_label.trim().length > 0;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="vendor">Vendor *</Label>
          <Input
            id="vendor"
            value={m.vendor_label}
            onChange={(e) => w.setMetadata({ vendor_label: e.target.value })}
            placeholder="e.g. Proxy-Seller"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="batch">Vendor order # (optional)</Label>
          <Input
            id="batch"
            value={m.batch_reference}
            onChange={(e) => w.setMetadata({ batch_reference: e.target.value })}
            placeholder="PS-12345"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="purchase">Purchase date</Label>
          <Input
            id="purchase"
            type="date"
            value={m.purchase_date}
            onChange={(e) => w.setMetadata({ purchase_date: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="expiry">Expiry date *</Label>
          <Input
            id="expiry"
            type="date"
            value={m.expiry_date}
            onChange={(e) => w.setMetadata({ expiry_date: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cost">Total cost</Label>
          <Input
            id="cost"
            type="number"
            step="0.01"
            min="0"
            value={m.total_cost_usd}
            onChange={(e) => w.setMetadata({ total_cost_usd: e.target.value })}
            placeholder="85.00"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="currency">Currency</Label>
          <Input
            id="currency"
            maxLength={3}
            value={m.currency}
            onChange={(e) => w.setMetadata({ currency: e.target.value.toUpperCase() })}
            placeholder="USD"
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Input
            id="notes"
            value={m.notes}
            onChange={(e) => w.setMetadata({ notes: e.target.value })}
            placeholder="Anything that helps you remember this lot"
          />
        </div>
      </div>

      <div className="rounded-md bg-muted/30 p-3 text-sm">
        Importing <strong>{validCount}</strong> proxies under{" "}
        <strong>{m.vendor_label || "(no vendor)"}</strong>
        {m.expiry_date && (
          <>
            {" "}
            expiring <strong>{m.expiry_date}</strong>
          </>
        )}
        {m.total_cost_usd && (
          <>
            {" "}
            for <strong>${m.total_cost_usd}</strong>
          </>
        )}
        .
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={w.backToParsed}>
          <ArrowLeft /> Back
        </Button>
        <Button onClick={w.submit} disabled={!canSubmit}>
          <Upload /> Confirm import
        </Button>
      </div>
    </div>
  );
}
