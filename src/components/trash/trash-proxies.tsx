"use client";

import { useEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import { RefreshCw, Trash2, RotateCcw } from "lucide-react";
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
import { Card, CardContent } from "@/components/ui/card";
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

interface TrashProxiesProps {
  canWrite: boolean;
}

export function TrashProxies({ canWrite }: TrashProxiesProps) {
  const [proxies, setProxies] = useState<DeletedProxy[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProxies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/proxies?isDeleted=true&pageSize=50");
      if (res.ok) {
        const result = await res.json();
        setProxies(result.data ?? []);
      }
    } catch (err) {
      console.error("Failed to fetch deleted proxies:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProxies();
  }, [fetchProxies]);

  const handleRestore = async (id: string) => {
    try {
      const res = await fetch(`/api/proxies/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_deleted: false, deleted_at: null }),
      });
      if (res.ok) {
        fetchProxies();
      }
    } catch (err) {
      console.error("Failed to restore proxy:", err);
    }
  };

  const handlePermanentDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/proxies/${id}?permanent=true`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchProxies();
      }
    } catch (err) {
      console.error("Failed to permanently delete proxy:", err);
    }
  };

  const renderLoading = () =>
    Array.from({ length: 3 }).map((_, i) => (
      <TableRow key={i}>
        {Array.from({ length: 5 }).map((_, j) => (
          <TableCell key={j}>
            <Skeleton className="h-4 w-full" />
          </TableCell>
        ))}
      </TableRow>
    ));

  return (
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
              renderLoading()
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
                    {canWrite && (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestore(proxy.id)}
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
                                  handlePermanentDelete(proxy.id)
                                }
                              >
                                Delete permanently
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
