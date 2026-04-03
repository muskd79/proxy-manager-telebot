"use client";

import { useEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import { Trash2, RotateCcw } from "lucide-react";
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

interface DeletedRequest {
  id: string;
  proxy_type: string | null;
  status: string;
  requested_at: string;
  deleted_at: string | null;
}

interface TrashRequestsProps {
  canWrite: boolean;
}

export function TrashRequests({ canWrite }: TrashRequestsProps) {
  const [requests, setRequests] = useState<DeletedRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/requests?isDeleted=true&pageSize=50");
      if (res.ok) {
        const result = await res.json();
        setRequests(result.data?.data ?? []);
      }
    } catch (err) {
      console.error("Failed to fetch deleted requests:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleRestore = async (id: string) => {
    try {
      const res = await fetch(`/api/requests/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_deleted: false, deleted_at: null }),
      });
      if (res.ok) {
        fetchRequests();
      }
    } catch (err) {
      console.error("Failed to restore request:", err);
    }
  };

  const handlePermanentDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/requests/${id}?permanent=true`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchRequests();
      }
    } catch (err) {
      console.error("Failed to permanently delete request:", err);
    }
  };

  const renderLoading = () =>
    Array.from({ length: 3 }).map((_, i) => (
      <TableRow key={i}>
        {Array.from({ length: 6 }).map((_, j) => (
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
              renderLoading()
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
                    {canWrite && (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestore(req.id)}
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
                                  handlePermanentDelete(req.id)
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
