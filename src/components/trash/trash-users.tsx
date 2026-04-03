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

interface DeletedUser {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  status: string;
  deleted_at: string | null;
}

interface TrashUsersProps {
  canWrite: boolean;
}

export function TrashUsers({ canWrite }: TrashUsersProps) {
  const [users, setUsers] = useState<DeletedUser[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users?isDeleted=true&pageSize=50");
      if (res.ok) {
        const result = await res.json();
        setUsers(result.data?.data ?? []);
      }
    } catch (err) {
      console.error("Failed to fetch deleted users:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleRestore = async (id: string) => {
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_deleted: false, deleted_at: null }),
      });
      if (res.ok) {
        fetchUsers();
      }
    } catch (err) {
      console.error("Failed to restore user:", err);
    }
  };

  const handlePermanentDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/users/${id}?permanent=true`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchUsers();
      }
    } catch (err) {
      console.error("Failed to permanently delete user:", err);
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
              <TableHead>Telegram ID</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Deleted At</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              renderLoading()
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
                    {canWrite && (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestore(user.id)}
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
                                  handlePermanentDelete(user.id)
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
