"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";
import type { ProxyRequest, TeleUser } from "@/types/database";

interface RequestWithUser extends ProxyRequest {
  tele_user?: Pick<TeleUser, "username" | "first_name" | "telegram_id"> | null;
  tele_users?: Pick<TeleUser, "username" | "first_name" | "telegram_id"> | null;
}

const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  approved: "default",
  auto_approved: "default",
  rejected: "destructive",
  expired: "secondary",
  cancelled: "secondary",
};

export function RecentRequests() {
  const [requests, setRequests] = useState<RequestWithUser[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchRequests() {
    try {
      const res = await fetch("/api/requests?pageSize=10&sortBy=created_at&sortOrder=desc");
      if (res.ok) {
        const result = await res.json();
        const items = result?.data?.data || result?.data || [];
        setRequests(Array.isArray(items) ? items : []);
      }
    } catch (err) {
      console.error("Failed to fetch recent requests:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRequests();
  }, []);

  async function handleAction(id: string, action: "approved" | "rejected") {
    // Phase 3 (PM UX) — confirm before firing the dashboard
    // 1-click Approve/Reject. Pre-fix tap → request fires
    // immediately (UI auditor B9). UX-mistake-cost is high
    // because the row is just an icon button next to others.
    const verb = action === "approved" ? "Phê duyệt" : "Từ chối";
    if (!window.confirm(`${verb} yêu cầu này?`)) return;

    try {
      const res = await fetch(`/api/requests/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: action }),
      });
      if (res.ok) {
        fetchRequests();
      }
    } catch (err) {
      console.error("Failed to handle request action:", err);
    }
  }

  function formatTime(dateStr: string) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Requests</CardTitle>
          <CardDescription>Latest proxy requests from users</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Requests</CardTitle>
        <CardDescription>Latest proxy requests from users</CardDescription>
      </CardHeader>
      <CardContent>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No requests found
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Time</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((req) => (
                <TableRow key={req.id}>
                  <TableCell className="font-medium">
                    {req.tele_user?.username || req.tele_user?.first_name ||
                      req.tele_users?.username || req.tele_users?.first_name ||
                      "Unknown"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {req.proxy_type || "any"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusColors[req.status] || "secondary"}>
                      {req.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatTime(req.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    {req.status === "pending" && (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleAction(req.id, "approved")}
                          className="text-emerald-500 hover:text-emerald-600"
                        >
                          <Check className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleAction(req.id, "rejected")}
                          className="text-red-500 hover:text-red-600"
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
