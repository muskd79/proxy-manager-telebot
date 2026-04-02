"use client";

import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import Link from "next/link";
import {
  User,
  Phone,
  Globe,
  Calendar,
  Shield,
  Ban,
  CheckCircle,
  ArrowLeft,
  Hash,
  StickyNote,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { UserRateLimit } from "./user-rate-limit";
import { UserChatPanel } from "./user-chat-panel";
import type { TeleUser, Proxy, ProxyRequest } from "@/types/database";
import type { ApiResponse } from "@/types/api";

interface UserDetailProps {
  userId: string;
  initialTab?: string;
}

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  blocked: "destructive",
  pending: "outline",
  banned: "destructive",
};

export function UserDetail({ userId, initialTab = "info" }: UserDetailProps) {
  const [user, setUser] = useState<TeleUser | null>(null);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [requests, setRequests] = useState<ProxyRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBlocking, setIsBlocking] = useState(false);
  const [notes, setNotes] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch(`/api/users/${userId}`);
      if (!res.ok) throw new Error("Failed to fetch user");
      const json: ApiResponse<TeleUser> = await res.json();
      if (json.success && json.data) {
        setUser(json.data);
        setNotes(json.data.notes || "");
      }
    } catch (err) {
      console.error("Failed to load user details:", err);
      toast.error("Failed to load user details");
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  const fetchProxies = useCallback(async () => {
    try {
      const res = await fetch(`/api/users/${userId}/proxies`);
      if (!res.ok) return;
      const json: ApiResponse<Proxy[]> = await res.json();
      if (json.success && json.data) {
        setProxies(json.data);
      }
    } catch (err) {
      console.error("Failed to fetch user proxies:", err);
    }
  }, [userId]);

  const fetchRequests = useCallback(async () => {
    try {
      const params = new URLSearchParams({ teleUserId: userId, pageSize: "50" });
      const res = await fetch(`/api/requests?${params.toString()}`);
      if (!res.ok) return;
      const json = await res.json();
      if (json.success && json.data?.data) {
        setRequests(json.data.data);
      }
    } catch (err) {
      console.error("Failed to fetch user requests:", err);
    }
  }, [userId]);

  useEffect(() => {
    fetchUser();
    fetchProxies();
    fetchRequests();
  }, [fetchUser, fetchProxies, fetchRequests]);

  const handleBlockToggle = async () => {
    if (!user) return;
    setIsBlocking(true);
    try {
      const newStatus = user.status === "blocked" || user.status === "banned" ? "active" : "blocked";
      const res = await fetch(`/api/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        toast.success(newStatus === "blocked" ? "User blocked" : "User unblocked");
        fetchUser();
      } else {
        toast.error("Failed to update user status");
      }
    } catch (err) {
      console.error("Failed to toggle user block status:", err);
      toast.error("An error occurred");
    } finally {
      setIsBlocking(false);
    }
  };

  const handleSaveNotes = async () => {
    setIsSavingNotes(true);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (res.ok) {
        toast.success("Notes saved");
      } else {
        toast.error("Failed to save notes");
      }
    } catch (err) {
      console.error("Failed to save notes:", err);
      toast.error("An error occurred");
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleRateLimitSave = async (data: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        fetchUser();
        return true;
      }
      return false;
    } catch (err) {
      console.error("Failed to save rate limits:", err);
      return false;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <p className="text-lg">User not found</p>
        <Button variant="ghost" render={<Link href="/users" />} className="mt-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Users
        </Button>
      </div>
    );
  }

  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || "Unknown";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" render={<Link href="/users" />}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{displayName}</h1>
            <p className="text-sm text-muted-foreground">
              @{user.username || "no_username"} | ID: {user.telegram_id}
            </p>
          </div>
        </div>
        <Button
          variant={user.status === "blocked" ? "default" : "destructive"}
          onClick={handleBlockToggle}
          disabled={isBlocking}
        >
          {isBlocking ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : user.status === "blocked" || user.status === "banned" ? (
            <CheckCircle className="mr-2 h-4 w-4" />
          ) : (
            <Ban className="mr-2 h-4 w-4" />
          )}
          {user.status === "blocked" || user.status === "banned" ? "Unblock" : "Block"}
        </Button>
      </div>

      <Tabs defaultValue={initialTab} className="space-y-6">
        <TabsList className="bg-muted">
          <TabsTrigger value="info">Info</TabsTrigger>
          <TabsTrigger value="proxies">
            Proxies ({proxies.length})
          </TabsTrigger>
          <TabsTrigger value="requests">
            Requests ({requests.length})
          </TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="rate-limits">Rate Limits</TabsTrigger>
        </TabsList>

        {/* Info Tab */}
        <TabsContent value="info" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-lg">User Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Hash className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Telegram ID</p>
                    <p className="font-mono">{user.telegram_id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Username</p>
                    <p>{user.username ? `@${user.username}` : "--"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Full Name</p>
                    <p>{displayName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p>{user.phone || "--"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Language</p>
                    <p className="uppercase">{user.language}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-lg">Status & Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <Badge variant={statusVariant[user.status] ?? "outline"}>
                      {user.status}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Approval Mode</p>
                    <Badge variant="secondary">{user.approval_mode}</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Created</p>
                    <p>{format(new Date(user.created_at), "PPpp")}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Updated</p>
                    <p>{format(new Date(user.updated_at), "PPpp")}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Notes */}
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <StickyNote className="h-4 w-4" />
                Notes
              </CardTitle>
              <CardDescription>Admin notes for this user</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about this user..."
                className="min-h-[100px] bg-background"
              />
              <Button onClick={handleSaveNotes} disabled={isSavingNotes} size="sm">
                {isSavingNotes ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Save Notes
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Proxies Tab */}
        <TabsContent value="proxies">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-lg">Assigned Proxies</CardTitle>
              <CardDescription>Proxies currently assigned to this user</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Host:Port</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assigned At</TableHead>
                    <TableHead>Expires At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proxies.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                        No proxies assigned
                      </TableCell>
                    </TableRow>
                  ) : (
                    proxies.map((proxy) => (
                      <TableRow key={proxy.id}>
                        <TableCell className="font-mono text-sm">
                          {proxy.host}:{proxy.port}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{proxy.type}</Badge>
                        </TableCell>
                        <TableCell>{proxy.country || "--"}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{proxy.status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {proxy.assigned_at
                            ? format(new Date(proxy.assigned_at), "MMM d, yyyy HH:mm")
                            : "--"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {proxy.expires_at
                            ? format(new Date(proxy.expires_at), "MMM d, yyyy HH:mm")
                            : "--"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Requests Tab */}
        <TabsContent value="requests">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-lg">Request History</CardTitle>
              <CardDescription>All proxy requests from this user</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Approval</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead>Processed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                        No requests yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    requests.map((req) => (
                      <TableRow key={req.id}>
                        <TableCell>
                          <Badge variant="outline">{req.proxy_type || "any"}</Badge>
                        </TableCell>
                        <TableCell>{req.country || "any"}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              req.status === "approved" || req.status === "auto_approved"
                                ? "default"
                                : req.status === "rejected"
                                  ? "destructive"
                                  : "outline"
                            }
                          >
                            {req.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{req.approval_mode || "--"}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(req.requested_at), "MMM d, yyyy HH:mm")}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {req.processed_at
                            ? format(new Date(req.processed_at), "MMM d, yyyy HH:mm")
                            : "--"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Chat Tab */}
        <TabsContent value="chat">
          <UserChatPanel userId={userId} />
        </TabsContent>

        {/* Rate Limits Tab */}
        <TabsContent value="rate-limits">
          <UserRateLimit user={user} onSave={handleRateLimitSave} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
