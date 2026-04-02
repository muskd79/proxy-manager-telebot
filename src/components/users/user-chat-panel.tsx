"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { format } from "date-fns";
import { Loader2, ChevronUp, Bot, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import type { ChatMessage, ChatDirection } from "@/types/database";
import type { ApiResponse } from "@/types/api";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface UserChatPanelProps {
  userId: string;
}

export function UserChatPanel({ userId }: UserChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const fetchMessages = useCallback(
    async (pageNum: number) => {
      try {
        const params = new URLSearchParams({
          user_id: userId,
          page: String(pageNum),
          limit: "20",
        });
        const res = await fetch(`/api/chat?${params.toString()}`);
        if (!res.ok) return;
        const json: ApiResponse<{ messages: ChatMessage[]; hasMore: boolean }> =
          await res.json();
        if (json.success && json.data) {
          if (pageNum === 1) {
            setMessages(json.data.messages);
          } else {
            setMessages((prev) => [...json.data!.messages, ...prev]);
          }
          setHasMore(json.data.hasMore);
          setPage(pageNum);
        }
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [userId]
  );

  // Initial load and realtime subscription
  useEffect(() => {
    setIsLoading(true);
    fetchMessages(1);

    const supabase = createClient();
    const channel = supabase
      .channel(`user-chat-${userId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `tele_user_id=eq.${userId}`,
        },
        (payload: { new: ChatMessage }) => {
          setMessages((prev) => [...prev, payload.new]);
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, fetchMessages]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const loadMore = async () => {
    if (!hasMore || isLoadingMore) return;
    setIsLoadingMore(true);
    await fetchMessages(page + 1);
  };

  const getMessageTypeColor = (type: string) => {
    switch (type) {
      case "command":
        return "text-blue-400";
      case "system":
        return "text-yellow-400";
      default:
        return "";
    }
  };

  if (isLoading) {
    return (
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg">Chat History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
              <Skeleton className="h-14 w-3/5 rounded-xl" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Chat History</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div
          ref={scrollRef}
          className="flex h-[500px] flex-col overflow-y-auto px-4 pb-4"
        >
          {hasMore && (
            <div className="flex justify-center py-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={loadMore}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ChevronUp className="mr-2 h-4 w-4" />
                )}
                Load More
              </Button>
            </div>
          )}

          {messages.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              No messages yet
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((msg) => {
                const isIncoming = msg.direction === "incoming";
                return (
                  <div
                    key={msg.id}
                    className={`flex items-end gap-2 ${
                      isIncoming ? "justify-start" : "justify-end"
                    }`}
                  >
                    {isIncoming && (
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    )}
                    <div
                      className={`max-w-[75%] rounded-xl px-3.5 py-2.5 ${
                        isIncoming
                          ? "bg-muted text-foreground"
                          : "bg-blue-600 text-white"
                      }`}
                    >
                      {msg.message_type !== "text" && (
                        <Badge
                          variant="outline"
                          className={`mb-1 text-[10px] ${
                            isIncoming ? "" : "border-blue-400 text-blue-200"
                          }`}
                        >
                          {msg.message_type}
                        </Badge>
                      )}
                      <p
                        className={`text-sm leading-relaxed ${getMessageTypeColor(
                          msg.message_type
                        )}`}
                      >
                        {msg.message_text || (
                          <span className="italic opacity-60">[no text]</span>
                        )}
                      </p>
                      <p
                        className={`mt-1 text-[10px] ${
                          isIncoming
                            ? "text-muted-foreground"
                            : "text-blue-200"
                        }`}
                      >
                        {format(new Date(msg.created_at), "HH:mm, MMM d")}
                      </p>
                    </div>
                    {!isIncoming && (
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600">
                        <Bot className="h-3.5 w-3.5 text-white" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
