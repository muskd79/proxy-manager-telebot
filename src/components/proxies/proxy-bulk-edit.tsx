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
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { X, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ProxyBulkEditProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  onComplete: () => void;
}

export function ProxyBulkEdit({ open, onOpenChange, selectedIds, onComplete }: ProxyBulkEditProps) {
  const [loading, setLoading] = useState(false);
  const [updateFields, setUpdateFields] = useState({
    status: "",
    country: "",
    isp: "",
    notes: "",
    tags: [] as string[],
    tagInput: "",
  });

  // Only update fields that admin has filled in (non-empty)
  const handleSave = async () => {
    setLoading(true);
    try {
      const updates: Record<string, unknown> = {};
      if (updateFields.status) updates.status = updateFields.status;
      if (updateFields.country) updates.country = updateFields.country;
      if (updateFields.isp) updates.isp = updateFields.isp;
      if (updateFields.notes) updates.notes = updateFields.notes;
      if (updateFields.tags.length > 0) updates.tags = updateFields.tags;

      if (Object.keys(updates).length === 0) {
        toast.error("No fields to update");
        return;
      }

      // Update each selected proxy
      let success = 0;
      for (const id of selectedIds) {
        const res = await fetch(`/api/proxies/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (res.ok) success++;
      }

      toast.success(`Updated ${success}/${selectedIds.length} proxies`);
      onComplete();
      onOpenChange(false);
    } catch (err) {
      console.error("Bulk edit error:", err);
      toast.error("Failed to update proxies");
    } finally {
      setLoading(false);
    }
  };

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !updateFields.tags.includes(trimmed)) {
      setUpdateFields(prev => ({ ...prev, tags: [...prev.tags, trimmed], tagInput: "" }));
    }
  };

  const removeTag = (tag: string) => {
    setUpdateFields(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }));
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
              placeholder="Leave empty to keep current"
            />
          </div>

          <div className="space-y-2">
            <Label>ISP</Label>
            <Input
              value={updateFields.isp}
              onChange={(e) => setUpdateFields(prev => ({ ...prev, isp: e.target.value }))}
              placeholder="Leave empty to keep current"
            />
          </div>

          <div className="space-y-2">
            <Label>Tags (replaces existing)</Label>
            <div className="flex flex-wrap gap-1 mb-1">
              {updateFields.tags.map(tag => (
                <Badge key={tag} variant="secondary" className="gap-1">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="ml-1">
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <Input
              value={updateFields.tagInput}
              onChange={(e) => setUpdateFields(prev => ({ ...prev, tagInput: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag(updateFields.tagInput);
                }
              }}
              placeholder="Type tag + Enter"
            />
          </div>

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
