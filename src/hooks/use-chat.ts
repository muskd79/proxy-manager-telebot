"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ChatMessage, TeleUser } from "@/types/database";
import type { ApiResponse } from "@/types/api";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface Conversation {
  user: TeleUser;
  lastMessage: ChatMessage | null;
  unreadCount: number;
}

interface UseChatReturn {
  conversations: Conversation[];
  messages: ChatMessage[];
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  error: string | null;
  selectedUserId: string | null;
  setSelectedUserId: (id: string | null) => void;
  fetchConversations: () => Promise<void>;
  fetchMessages: (userId: string, page?: number) => Promise<void>;
  hasMoreMessages: boolean;
  loadMoreMessages: () => Promise<void>;
}

export function useChat(): UseChatReturn {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [messagePage, setMessagePage] = useState(1);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const fetchConversations = useCallback(async () => {
    setIsLoadingConversations(true);
    setError(null);
    try {
      const res = await fetch("/api/chat");
      if (!res.ok) throw new Error("Failed to fetch conversations");
      const json: ApiResponse<Conversation[]> = await res.json();
      if (json.success && json.data) {
        setConversations(json.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  const fetchMessages = useCallback(
    async (userId: string, page = 1) => {
      setIsLoadingMessages(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          user_id: userId,
          page: String(page),
          limit: "50",
        });
        const res = await fetch(`/api/chat?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch messages");
        const json: ApiResponse<{ messages: ChatMessage[]; hasMore: boolean }> =
          await res.json();

        if (json.success && json.data) {
          if (page === 1) {
            setMessages(json.data.messages);
          } else {
            setMessages((prev) => [...json.data!.messages, ...prev]);
          }
          setHasMoreMessages(json.data.hasMore);
          setMessagePage(page);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoadingMessages(false);
      }
    },
    []
  );

  const loadMoreMessages = useCallback(async () => {
    if (!selectedUserId || !hasMoreMessages) return;
    await fetchMessages(selectedUserId, messagePage + 1);
  }, [selectedUserId, hasMoreMessages, messagePage, fetchMessages]);

  // Subscribe to realtime messages for the selected user
  useEffect(() => {
    if (!selectedUserId) return;

    const supabase = createClient();

    if (channelRef.current) {
      channelRef.current.unsubscribe();
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase
      .channel(`chat-${selectedUserId}`)
      .on(
        "postgres_changes" as any,
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `tele_user_id=eq.${selectedUserId}`,
        },
        (payload: { new: ChatMessage }) => {
          setMessages((prev) => [...prev, payload.new]);
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.error('Realtime subscription error on chat channel');
        }
      });

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [selectedUserId]);

  // Fetch messages when user is selected
  useEffect(() => {
    if (selectedUserId) {
      fetchMessages(selectedUserId, 1);
    } else {
      setMessages([]);
    }
  }, [selectedUserId, fetchMessages]);

  // Initial fetch
  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  return {
    conversations,
    messages,
    isLoadingConversations,
    isLoadingMessages,
    error,
    selectedUserId,
    setSelectedUserId,
    fetchConversations,
    fetchMessages,
    hasMoreMessages,
    loadMoreMessages,
  };
}
