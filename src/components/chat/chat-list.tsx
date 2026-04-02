"use client";

import { useState } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { Search, User, MessageCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { Conversation } from "@/hooks/use-chat";

interface ChatListProps {
  conversations: Conversation[];
  isLoading: boolean;
  selectedUserId: string | null;
  onSelectUser: (userId: string) => void;
}

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  if (isToday(date)) return format(date, "HH:mm");
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMM d");
}

function getInitials(firstName?: string | null, lastName?: string | null): string {
  const f = firstName?.charAt(0) ?? "";
  const l = lastName?.charAt(0) ?? "";
  return (f + l).toUpperCase() || "?";
}

export function ChatList({
  conversations,
  isLoading,
  selectedUserId,
  onSelectUser,
}: ChatListProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = conversations.filter((conv) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const user = conv.user;
    return (
      user.username?.toLowerCase().includes(q) ||
      user.first_name?.toLowerCase().includes(q) ||
      user.last_name?.toLowerCase().includes(q) ||
      String(user.telegram_id).includes(q)
    );
  });

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border p-3">
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="flex-1 space-y-1 p-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg p-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-background pl-10"
          />
        </div>
      </div>

      {/* Conversation list */}
      <ScrollArea className="flex-1">
        <div className="space-y-0.5 p-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <MessageCircle className="mb-2 h-8 w-8 opacity-40" />
              <p className="text-sm">No conversations found</p>
            </div>
          ) : (
            filtered.map((conv) => {
              const user = conv.user;
              const isSelected = selectedUserId === user.id;
              const displayName =
                user.username
                  ? `@${user.username}`
                  : [user.first_name, user.last_name].filter(Boolean).join(" ") ||
                    `ID: ${user.telegram_id}`;

              return (
                <button
                  key={user.id}
                  onClick={() => onSelectUser(user.id)}
                  className={`flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors ${
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div className="relative">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                        {getInitials(user.first_name, user.last_name)}
                      </AvatarFallback>
                    </Avatar>
                    {conv.unreadCount > 0 && (
                      <div className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">
                        {conv.unreadCount}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <p className="truncate text-sm font-medium">
                        {displayName}
                      </p>
                      {conv.lastMessage && (
                        <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">
                          {formatTimestamp(conv.lastMessage.created_at)}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {conv.lastMessage?.message_text || "No messages"}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
