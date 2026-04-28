"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Bulk-edit dialog for the proxies list.
 *
 * Wave 22E-3 — switched the network call from N per-row PUTs to a single
 * /api/proxies/bulk-edit POST that calls the safe_bulk_edit_proxies RPC
 * (status guard + UPDATE in one transaction). Cuts a 1000-row bulk from
 * ~30s to ~200ms and eliminates the state-machine race.
 *
 * Wave 22C — tags input removed. Strong categories supersede flat tags;
 * use /categories admin page or the bulk-assign-to-category dropdown.
 */

interface ProxyBulkEditProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  onComplete: () => void;
}

export function ProxyBulkEdit({ open, onOpenChange, selectedIds, onComplete }: ProxyBulkEditProps) {
  const [loading, setLoading] = useState(false);
  // Wave 22Y — isp field removed from bulk-edit dialog (column dropped from UI)
  const [updateFields, setUpdateFields] = useState({
    status: "",
    country: "",
    notes: "",
  });

  const handleSave = async () => {
    setLoading(true);
    try {
      const updates: Record<string, unknown> = {};
      if (updateFields.status) updates.status = updateFields.status;
      // Wave 22E-3 contract: bulk-edit endpoint accepts status, notes,
      // is_deleted, extend_expiry_days, tags_add, tags_remove. country
      // and isp are not yet supported by the RPC; keep the inputs in the
      // dialog as placeholders for a future wave but skip them server-
      // side (no-op rather than 400) to keep UX consistent.
      if (updateFields.notes) updates.notes = updateFields.notes;

      // country / isp deferred until safe_bulk_edit_proxies adds support.

      if (Object.keys(updates).length === 0) {
        toast.error("No fields to update (status or notes required)");
        return;
      }

      const res = await fetch("/api/proxies/bulk-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, updates }),
      });
      const body = await res.json();

      if (!body.success) {
        toast.error(body.error ?? `Failed (${res.status})`);
        return;
      }

      toast.success(
        `Updated ${body.data.updated}/${body.data.requested} proxies`,
      );
      onComplete();
      onOpenChange(false);
    } catch (err) {
      console.error("Bulk edit error:", err);
      toast.error("Failed to update proxies");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk Edit {selectedIds.length} Proxies</DialogTitle>
          <DialogDescription>Only filled fields will be updated. Leave empty to keep current values.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={updateFields.status} onValueChange={(v) => setUpdateFields(prev => ({ ...prev, status: v ?? "" }))}>
              <SelectTrigger><SelectValue placeholder="Keep current" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
                <SelectItem value="banned">Banned</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Country</Label>
            <Input
              value={updateFields.country}
              onChange={(e) => setUpdateFields(prev => ({ ...prev, country: e.target.value }))}
              placeholder="(deferred — not yet wired into bulk RPC)"
              disabled
            />
          </div>

          {/* Wave 22Y — ISP bulk-edit field removed (column dropped from UI) */}
          {/* Wave 22C: tags input removed. Use /categories for groupings. */}

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={updateFields.notes}
              onChange={(e) => setUpdateFields(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Leave empty to keep current"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="size-4 mr-1.5 animate-spin" />}
            Update {selectedIds.length} Proxies
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
