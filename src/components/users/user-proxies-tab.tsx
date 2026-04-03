"use client";

import { useEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Proxy } from "@/types/database";
import type { ApiResponse } from "@/types/api";

interface UserProxiesTabProps {
  userId: string;
}

export function UserProxiesTab({ userId }: UserProxiesTabProps) {
  const [proxies, setProxies] = useState<Proxy[]>([]);

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

  useEffect(() => {
    fetchProxies();
  }, [fetchProxies]);

  return (
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
  );
}
