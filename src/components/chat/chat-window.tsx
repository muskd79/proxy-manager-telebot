"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Loader2, ChevronUp, MessageCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageBubble } from "./message-bubble";
import type { ChatMessage, TeleUser } from "@/types/database";

interface ChatWindowProps {
  user: TeleUser | null;
  messages: ChatMessage[];
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

function getInitials(firstName?: string | null, lastName?: string | null): string {
  const f = firstName?.charAt(0) ?? "";
  const l = lastName?.charAt(0) ?? "";
  return (f + l).toUpperCase() || "?";
}

export function ChatWindow({
  user,
  messages,
  isLoading,
  hasMore,
  onLoadMore,
}: ChatWindowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevMessageCountRef.current = messages.length;
  }, [messages]);

  // No user selected state
  if (!user) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
        <MessageCircle className="mb-3 h-12 w-12 opacity-30" />
        <p className="text-lg font-medium">Select a conversation</p>
        <p className="text-sm">Choose a user from the list to view their chat</p>
      </div>
    );
  }

  const displayName =
    [user.first_name, user.last_name].filter(Boolean).join(" ") || "Unknown User";

  return (
    <div className="flex h-full flex-col">
      {/* Chat Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Avatar className="h-9 w-9">
          <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
            {getInitials(user.first_name, user.last_name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium">{displayName}</p>
            <Badge
              variant={user.status === "active" ? "default" : "destructive"}
              className="text-[10px]"
            >
              {user.status}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {user.username ? `@${user.username}` : `Telegram ID: ${user.telegram_id}`}
          </p>
        </div>
        <Button variant="ghost" size="sm" render={<Link href={`/users/${user.id}`} />}>
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            Profile
        </Button>
      </div>

      {/* Messages Area */}
      <div
        ref={scrollRef}
        className="flex flex-1 flex-col overflow-y-auto px-4 py-4"
      >
        {/* Load more button */}
        {hasMore && (
          <div className="flex justify-center pb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={onLoadMore}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ChevronUp className="mr-2 h-4 w-4" />
              )}
              Load older messages
            </Button>
          </div>
        )}

        {isLoading && messages.length === 0 ? (
          <div className="flex-1 space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}
              >
                <Skeleton className="h-14 w-3/5 rounded-xl" />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <p className="text-sm">No messages in this conversation</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
