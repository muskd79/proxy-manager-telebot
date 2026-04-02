"use client";

import { useState, useEffect, useCallback } from "react";
import { CheckCircle, XCircle, Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { Proxy } from "@/types/database";
import type { ApiResponse } from "@/types/api";

// ---- Approve Dialog ----
interface ApproveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string;
  onApproved: () => void;
}

export function ApproveDialog({
  open,
  onOpenChange,
  requestId,
  onApproved,
}: ApproveDialogProps) {
  const [availableProxies, setAvailableProxies] = useState<Proxy[]>([]);
  const [selectedProxyId, setSelectedProxyId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchProxies = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/proxies?status=available&pageSize=100");
      if (!res.ok) return;
      const json = await res.json();
      if (json.success && json.data?.data) {
        setAvailableProxies(json.data.data);
      }
    } catch (err) {
      console.error("Failed to load available proxies:", err);
      toast.error("Failed to load available proxies");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchProxies();
      setSelectedProxyId("");
    }
  }, [open, fetchProxies]);

  const handleApprove = async () => {
    if (!selectedProxyId) {
      toast.error("Please select a proxy to assign");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/requests/${requestId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "approved",
          proxy_id: selectedProxyId,
        }),
      });

      if (res.ok) {
        toast.success("Request approved");
        onApproved();
        onOpenChange(false);
      } else {
        const json = await res.json();
        toast.error(json.error || "Failed to approve request");
      }
    } catch (err) {
      console.error("Failed to approve request:", err);
      toast.error("An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Approve Request
          </DialogTitle>
          <DialogDescription>
            Select a proxy to assign to this request.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Available Proxy</Label>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading proxies...
              </div>
            ) : availableProxies.length === 0 ? (
              <p className="text-sm text-destructive">
                No available proxies. Add proxies first.
              </p>
            ) : (
              <Select value={selectedProxyId} onValueChange={(v) => setSelectedProxyId(v ?? '')}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Select a proxy" />
                </SelectTrigger>
                <SelectContent>
                  {availableProxies.map((proxy) => (
                    <SelectItem key={proxy.id} value={proxy.id}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">
                          {proxy.host}:{proxy.port}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {proxy.type}
                        </Badge>
                        {proxy.country && (
                          <span className="text-xs text-muted-foreground">
                            {proxy.country}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleApprove}
            disabled={isSubmitting || !selectedProxyId}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Reject Dialog ----
interface RejectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string;
  onRejected: () => void;
}

export function RejectDialog({
  open,
  onOpenChange,
  requestId,
  onRejected,
}: RejectDialogProps) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleReject = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/requests/${requestId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "rejected",
          rejected_reason: reason || null,
        }),
      });

      if (res.ok) {
        toast.success("Request rejected");
        onRejected();
        onOpenChange(false);
        setReason("");
      } else {
        const json = await res.json();
        toast.error(json.error || "Failed to reject request");
      }
    } catch (err) {
      console.error("Failed to reject request:", err);
      toast.error("An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-destructive" />
            Reject Request
          </DialogTitle>
          <DialogDescription>
            Provide an optional reason for rejecting this request.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Rejection Reason (optional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter the reason for rejection..."
              className="min-h-[100px] bg-background"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleReject}
            disabled={isSubmitting}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Batch Approve Dialog ----
interface BatchApproveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestIds: string[];
  onApproved: () => void;
}

export function BatchApproveDialog({
  open,
  onOpenChange,
  requestIds,
  onApproved,
}: BatchApproveDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleBatchApprove = async () => {
    setIsSubmitting(true);
    let successCount = 0;

    try {
      for (const id of requestIds) {
        const res = await fetch(`/api/requests/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "approved",
            auto_assign: true,
          }),
        });
        if (res.ok) successCount++;
      }

      toast.success(`${successCount}/${requestIds.length} requests approved`);
      onApproved();
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to batch approve requests:", err);
      toast.error("An error occurred during batch approval");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            Batch Approve Requests
          </DialogTitle>
          <DialogDescription>
            Auto-assign available proxies to {requestIds.length} selected request(s).
            Proxies will be assigned automatically based on request criteria.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleBatchApprove} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Approve All ({requestIds.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
