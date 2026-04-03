"use client";

import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import Link from "next/link";
import {
  ArrowLeft,
  Ban,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { UserInfoCard } from "./user-info-card";
import { UserProxiesTab } from "./user-proxies-tab";
import { UserRateLimit } from "./user-rate-limit";
import { UserChatPanel } from "./user-chat-panel";
import type { TeleUser, ProxyRequest } from "@/types/database";
import type { ApiResponse } from "@/types/api";

interface UserDetailProps {
  userId: string;
  initialTab?: string;
}

export function UserDetail({ userId, initialTab = "info" }: UserDetailProps) {
  const [user, setUser] = useState<TeleUser | null>(null);
  const [requests, setRequests] = useState<ProxyRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBlocking, setIsBlocking] = useState(false);

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch(`/api/users/${userId}`);
      if (!res.ok) throw new Error("Failed to fetch user");
      const json: ApiResponse<TeleUser> = await res.json();
      if (json.success && json.data) {
        setUser(json.data);
      }
    } catch (err) {
      console.error("Failed to load user details:", err);
      toast.error("Failed to load user details");
    } finally {
      setIsLoading(false);
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
    fetchRequests();
  }, [fetchUser, fetchRequests]);

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
        <Link href="/users" className={buttonVariants({ variant: "ghost" }) + " mt-4"}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Users
        </Link>
      </div>
    );
  }

  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || "Unknown";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/users" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
          </Link>
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
          <TabsTrigger value="proxies">Proxies</TabsTrigger>
          <TabsTrigger value="requests">
            Requests ({requests.length})
          </TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="rate-limits">Rate Limits</TabsTrigger>
        </TabsList>

        {/* Info Tab */}
        <TabsContent value="info">
          <UserInfoCard user={user} userId={userId} />
        </TabsContent>

        {/* Proxies Tab */}
        <TabsContent value="proxies">
          <UserProxiesTab userId={userId} />
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
