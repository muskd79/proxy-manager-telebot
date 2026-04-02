"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Globe } from "lucide-react";

interface ActiveUser {
  id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  telegram_id: number;
  last_message?: string | null;
  proxy_count: number;
}

export function ActiveUsers() {
  const [users, setUsers] = useState<ActiveUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchActiveUsers() {
      try {
        const res = await fetch(
          "/api/users?pageSize=10&sortBy=updated_at&sortOrder=desc&status=active"
        );
        if (res.ok) {
          const result = await res.json();
          const raw = result?.data?.data || result?.data || [];
          const usersData = Array.isArray(raw) ? raw : [];
          setUsers(
            usersData.map((u: Record<string, unknown>) => ({
              id: u.id,
              username: u.username,
              first_name: u.first_name,
              last_name: u.last_name,
              telegram_id: u.telegram_id,
              last_message: null,
              proxy_count: u.proxies_used_total || 0,
            }))
          );
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }

    fetchActiveUsers();
  }, []);

  function getInitials(user: ActiveUser): string {
    if (user.first_name) {
      return user.first_name.charAt(0).toUpperCase();
    }
    if (user.username) {
      return user.username.charAt(0).toUpperCase();
    }
    return "U";
  }

  function getDisplayName(user: ActiveUser): string {
    if (user.username) return `@${user.username}`;
    const parts = [user.first_name, user.last_name].filter(Boolean);
    return parts.join(" ") || `User ${user.telegram_id}`;
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Active Users</CardTitle>
          <CardDescription>Users active in the last 24 hours</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="size-8 animate-pulse rounded-full bg-muted" />
                <div className="flex-1 space-y-1">
                  <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Users</CardTitle>
        <CardDescription>Users active in the last 24 hours</CardDescription>
      </CardHeader>
      <CardContent>
        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No active users
          </p>
        ) : (
          <div className="space-y-4">
            {users.map((user) => (
              <div key={user.id} className="flex items-center gap-3">
                <Avatar>
                  <AvatarFallback>{getInitials(user)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {getDisplayName(user)}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {user.last_message || "No recent messages"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="gap-1">
                    <Globe className="size-3" />
                    {user.proxy_count}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
