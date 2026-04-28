"use client";

import { useState } from "react";
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
import {
  Activity,
  Pencil,
  Trash2,
  Copy,
  Globe,
  Clock,
  Server,
  User,
  Loader2,
} from "lucide-react";
import type { Proxy, ProxyRequest } from "@/types/database";
import Link from "next/link";

interface ProxyDetailProps {
  proxy: Proxy;
  assignmentHistory: ProxyRequest[];
  onEdit: () => void;
  onDelete: () => void;
  onHealthCheck: () => void;
}

const statusColors: Record<string, string> = {
  available: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  assigned: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  expired: "bg-red-500/10 text-red-500 border-red-500/20",
  banned: "bg-red-700/10 text-red-700 border-red-700/20",
  maintenance: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
};

export function ProxyDetail({
  proxy,
  assignmentHistory,
  onEdit,
  onDelete,
  onHealthCheck,
}: ProxyDetailProps) {
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleHealthCheck() {
    setChecking(true);
    try {
      await onHealthCheck();
    } finally {
      setChecking(false);
    }
  }

  function handleCopy() {
    const proxyStr = proxy.username
      ? `${proxy.host}:${proxy.port}:${proxy.username}:${proxy.password}`
      : `${proxy.host}:${proxy.port}`;
    navigator.clipboard.writeText(proxyStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      {/* Proxy Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Server className="size-5" />
                {proxy.host}:{proxy.port}
              </CardTitle>
              <CardDescription>
                Created{" "}
                {new Date(proxy.created_at).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleCopy}>
                <Copy className="size-4 mr-1" />
                {copied ? "Copied!" : "Copy"}
              </Button>
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Pencil className="size-4 mr-1" />
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleHealthCheck}
                disabled={checking}
              >
                {checking ? (
                  <Loader2 className="size-4 mr-1 animate-spin" />
                ) : (
                  <Activity className="size-4 mr-1" />
                )}
                Health Check
              </Button>
              <Button variant="destructive" size="sm" onClick={onDelete}>
                <Trash2 className="size-4 mr-1" />
                Delete
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Type</p>
              <span
                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
                  proxy.type === "http"
                    ? "bg-cyan-500/10 text-cyan-500 border-cyan-500/20"
                    : proxy.type === "https"
                    ? "bg-green-500/10 text-green-500 border-green-500/20"
                    : "bg-purple-500/10 text-purple-500 border-purple-500/20"
                }`}
              >
                {proxy.type.toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Status</p>
              <span
                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
                  statusColors[proxy.status] || ""
                }`}
              >
                {proxy.status}
              </span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Speed</p>
              <p className="text-sm font-medium">
                {proxy.speed_ms != null ? `${proxy.speed_ms}ms` : "Not tested"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Last Checked</p>
              <p className="text-sm font-medium">
                {proxy.last_checked_at
                  ? new Date(proxy.last_checked_at).toLocaleString()
                  : "Never"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Country</p>
              <p className="text-sm font-medium flex items-center gap-1">
                <Globe className="size-3.5" />
                {proxy.country || "Unknown"}
                {proxy.city && ` / ${proxy.city}`}
              </p>
            </div>
            {/* Wave 22Y — ISP block removed from proxy detail view */}
            <div>
              <p className="text-xs text-muted-foreground mb-1">Assigned To</p>
              {proxy.assigned_to ? (
                <Link
                  href={`/users/${proxy.assigned_to}`}
                  className="text-sm text-blue-400 hover:underline flex items-center gap-1"
                >
                  <User className="size-3.5" />
                  View User
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">Not assigned</p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Expires</p>
              <p className="text-sm font-medium flex items-center gap-1">
                <Clock className="size-3.5" />
                {proxy.expires_at
                  ? new Date(proxy.expires_at).toLocaleDateString()
                  : "No expiry"}
              </p>
            </div>
          </div>

          {proxy.username && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-xs text-muted-foreground mb-1">
                Authentication
              </p>
              <p className="text-sm font-mono">
                {proxy.username}:{"*".repeat(8)}
              </p>
            </div>
          )}

          {/* Wave 22J — tags column dropped (mig 037). Categories
              replaced flat tags. The category badge is shown above. */}

          {proxy.notes && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-xs text-muted-foreground mb-1">Notes</p>
              <p className="text-sm">{proxy.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Assignment History */}
      <Card>
        <CardHeader>
          <CardTitle>Assignment History</CardTitle>
          <CardDescription>Previous assignments for this proxy</CardDescription>
        </CardHeader>
        <CardContent>
          {assignmentHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No assignment history
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Processed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignmentHistory.map((req) => (
                  <TableRow key={req.id}>
                    <TableCell>
                      <Link
                        href={`/users/${req.tele_user_id}`}
                        className="text-blue-400 hover:underline"
                      >
                        {req.tele_user_id.substring(0, 8)}...
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          req.status === "approved" ||
                          req.status === "auto_approved"
                            ? "default"
                            : req.status === "rejected"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {req.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(req.requested_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {req.processed_at
                        ? new Date(req.processed_at).toLocaleString()
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
