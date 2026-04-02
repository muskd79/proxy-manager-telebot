"use client";

import { useMemo } from "react";
import { MessageCircle } from "lucide-react";
import { ChatList } from "@/components/chat/chat-list";
import { ChatWindow } from "@/components/chat/chat-window";
import { useChat } from "@/hooks/use-chat";

export default function ChatPage() {
  const {
    conversations,
    messages,
    isLoadingConversations,
    isLoadingMessages,
    selectedUserId,
    setSelectedUserId,
    hasMoreMessages,
    loadMoreMessages,
  } = useChat();

  const selectedUser = useMemo(() => {
    if (!selectedUserId) return null;
    const conv = conversations.find((c) => c.user.id === selectedUserId);
    return conv?.user ?? null;
  }, [selectedUserId, conversations]);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col p-6">
      {/* Page Header */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <MessageCircle className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Chat Monitor</h1>
          <p className="text-sm text-muted-foreground">
            View conversations between the bot and Telegram users
          </p>
        </div>
      </div>

      {/* Chat Layout */}
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
        {/* Left Panel: Conversation List */}
        <div className="w-80 shrink-0 border-r border-border">
          <ChatList
            conversations={conversations}
            isLoading={isLoadingConversations}
            selectedUserId={selectedUserId}
            onSelectUser={setSelectedUserId}
          />
        </div>

        {/* Right Panel: Chat Window */}
        <div className="min-w-0 flex-1">
          <ChatWindow
            user={selectedUser}
            messages={messages}
            isLoading={isLoadingMessages}
            hasMore={hasMoreMessages}
            onLoadMore={loadMoreMessages}
          />
        </div>
      </div>
    </div>
  );
}
