"use client";

import { useEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import { RefreshCw, Trash2, RotateCcw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface DeletedProxy {
  id: string;
  host: string;
  port: number;
  type: string;
  status: string;
  deleted_at: string | null;
}

interface DeletedUser {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  status: string;
  deleted_at: string | null;
}

interface DeletedRequest {
  id: string;
  proxy_type: string | null;
  status: string;
  requested_at: string;
  deleted_at: string | null;
}

export default function TrashPage() {
  const [tab, setTab] = useState("proxies");
  const [proxies, setProxies] = useState<DeletedProxy[]>([]);
  const [users, setUsers] = useState<DeletedUser[]>([]);
  const [requests, setRequests] = useState<DeletedRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTrash = useCallback(async () => {
    setLoading(true);
    try {
      const [proxiesRes, usersRes, requestsRes] = await Promise.all([
        fetch("/api/proxies?isDeleted=true&pageSize=50"),
        fetch("/api/proxies?isDeleted=true&pageSize=50"), // placeholder for users endpoint
        fetch("/api/proxies?isDeleted=true&pageSize=50"), // placeholder for requests endpoint
      ]);

      if (proxiesRes.ok) {
        const result = await proxiesRes.json();
        setProxies(result.data ?? []);
      }

      // For users: try dedicated endpoint or use proxy endpoint pattern
      try {
        const uRes = await fetch("/api/proxies?isDeleted=true&pageSize=50");
        if (uRes.ok) {
          // placeholder - users endpoint would go here
        }
      } catch {
        // silently handle
      }

      // Reset users/requests with empty arrays if no dedicated endpoints yet
      if (usersRes.ok) setUsers([]);
      if (requestsRes.ok) setRequests([]);
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrash();
  }, [fetchTrash]);

  const handleRestore = async (
    type: "proxy" | "user" | "request",
    id: string
  ) => {
    try {
      const endpoint =
        type === "proxy"
          ? `/api/proxies/${id}`
          : type === "user"
          ? `/api/proxies/${id}` // placeholder
          : `/api/proxies/${id}`; // placeholder

      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_deleted: false, deleted_at: null }),
      });

      if (res.ok) {
        fetchTrash();
      }
    } catch {
      // silently handle
    }
  };

  const handlePermanentDelete = async (
    type: "proxy" | "user" | "request",
    id: string
  ) => {
    try {
      const endpoint =
        type === "proxy"
          ? `/api/proxies/${id}`
          : type === "user"
          ? `/api/proxies/${id}` // placeholder
          : `/api/proxies/${id}`; // placeholder

      const res = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permanent: true }),
      });

      if (res.ok) {
        fetchTrash();
      }
    } catch {
      // silently handle
    }
  };

  const renderLoading = (cols: number) =>
    Array.from({ length: 3 }).map((_, i) => (
      <TableRow key={i}>
        {Array.from({ length: cols }).map((_, j) => (
          <TableCell key={j}>
            <Skeleton className="h-4 w-full" />
          </TableCell>
        ))}
      </TableRow>
    ));

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Trash</h1>
          <p className="text-muted-foreground">
            Manage soft-deleted items. Items are permanently removed after 30
            days.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchTrash}
          disabled={loading}
        >
          <RefreshCw
            className={`size-4 mr-1.5 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Auto-clean info */}
      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
        <CardContent className="flex items-center gap-3 py-3">
          <AlertTriangle className="size-5 text-amber-600" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Items in trash are automatically permanently deleted after 30 days.
            Restore items before then to keep them.
          </p>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="proxies">
            Proxies{" "}
            {proxies.length > 0 && (
              <Badge variant="secondary" className="ml-1.5">
                {proxies.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="users">
            Users{" "}
            {users.length > 0 && (
              <Badge variant="secondary" className="ml-1.5">
                {users.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="requests">
            Requests{" "}
            {requests.length > 0 && (
              <Badge variant="secondary" className="ml-1.5">
                {requests.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Proxies tab */}
        <TabsContent value="proxies">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Proxy</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Deleted At</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    renderLoading(5)
                  ) : proxies.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No deleted proxies
                      </TableCell>
                    </TableRow>
                  ) : (
                    proxies.map((proxy) => (
                      <TableRow key={proxy.id}>
                        <TableCell className="font-mono text-sm">
                          {proxy.host}:{proxy.port}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {proxy.type.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{proxy.status}</Badge>
                        </TableCell>
                        <TableCell>
                          {proxy.deleted_at
                            ? format(
                                new Date(proxy.deleted_at),
                                "yyyy-MM-dd HH:mm"
                              )
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRestore("proxy", proxy.id)}
                            >
                              <RotateCcw className="size-4 mr-1" />
                              Restore
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
                                  <Trash2 className="size-4 mr-1" />
                                  Delete
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    Permanently delete?
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This action cannot be undone. The proxy will
                                    be permanently removed.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() =>
                                      handlePermanentDelete("proxy", proxy.id)
                                    }
                                  >
                                    Delete permanently
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Users tab */}
        <TabsContent value="users">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Telegram ID</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Deleted At</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    renderLoading(5)
                  ) : users.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No deleted users
                      </TableCell>
                    </TableRow>
                  ) : (
                    users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-mono text-sm">
                          {user.telegram_id}
                        </TableCell>
                        <TableCell>
                          {user.username ? `@${user.username}` : "-"}
                        </TableCell>
                        <TableCell>{user.first_name ?? "-"}</TableCell>
                        <TableCell>
                          {user.deleted_at
                            ? format(
                                new Date(user.deleted_at),
                                "yyyy-MM-dd HH:mm"
                              )
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRestore("user", user.id)}
                            >
                              <RotateCcw className="size-4 mr-1" />
                              Restore
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
                                  <Trash2 className="size-4 mr-1" />
                                  Delete
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    Permanently delete?
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This action cannot be undone. The user will
                                    be permanently removed.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() =>
                                      handlePermanentDelete("user", user.id)
                                    }
                                  >
                                    Delete permanently
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Requests tab */}
        <TabsContent value="requests">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Proxy Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Requested At</TableHead>
                    <TableHead>Deleted At</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    renderLoading(6)
                  ) : requests.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No deleted requests
                      </TableCell>
                    </TableRow>
                  ) : (
                    requests.map((req) => (
                      <TableRow key={req.id}>
                        <TableCell className="font-mono text-sm">
                          {req.id.slice(0, 8)}...
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {req.proxy_type?.toUpperCase() ?? "N/A"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{req.status}</Badge>
                        </TableCell>
                        <TableCell>
                          {format(
                            new Date(req.requested_at),
                            "yyyy-MM-dd HH:mm"
                          )}
                        </TableCell>
                        <TableCell>
                          {req.deleted_at
                            ? format(
                                new Date(req.deleted_at),
                                "yyyy-MM-dd HH:mm"
                              )
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                handleRestore("request", req.id)
                              }
                            >
                              <RotateCcw className="size-4 mr-1" />
                              Restore
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
                                  <Trash2 className="size-4 mr-1" />
                                  Delete
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    Permanently delete?
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This action cannot be undone. The request
                                    will be permanently removed.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() =>
                                      handlePermanentDelete("request", req.id)
                                    }
                                  >
                                    Delete permanently
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
