"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { format } from "date-fns";
import { BotSubTabs } from "@/components/bot/bot-sub-tabs";
import { useRole } from "@/lib/role-context";
import { ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  Bot,
  User,
  Terminal,
  Send,
  Trash2,
  Loader2,
  Play,
  MessageSquare,
  Cog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { ChatMessage, TeleUser } from "@/types/database";
import type { RealtimeChannel } from "@supabase/supabase-js";

// All bot commands available in the simulator
const BOT_COMMANDS = [
  { name: "start", label: "/start", description: "Chào & đăng ký" },
  { name: "getproxy", label: "/getproxy", description: "Yêu cầu proxy" },
  { name: "myproxies", label: "/myproxies", description: "Xem proxy" },
  { name: "checkproxy", label: "/checkproxy", description: "Kiểm tra" },
  { name: "status", label: "/status", description: "Trạng thái tài khoản" },
  { name: "history", label: "/history", description: "Lịch sử yêu cầu" },
  { name: "revoke", label: "/revoke", description: "Trả proxy" },
  { name: "cancel", label: "/cancel", description: "Huỷ đang chờ" },
  { name: "language", label: "/language", description: "Đổi ngôn ngữ" },
  { name: "support", label: "/support", description: "Hỗ trợ" },
  { name: "help", label: "/help", description: "Xem trợ giúp" },
  { name: "requests", label: "/requests", description: "Yêu cầu admin" },
];

interface InlineButton {
  text: string;
  callback_data?: string;
}

export default function BotSimulatorPage() {
  // Wave 22X — role gate. Pre-fix any viewer could fire commands as
  // any tele_user via /api/bot-simulator/command. UX-agent flagged this
  // as a BLOCKER (impersonation surface). Server still enforces, this
  // is the client-side affordance.
  const { canWrite } = useRole();
  const router = useRouter();
  const [users, setUsers] = useState<TeleUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [customCommand, setCustomCommand] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const prevMessageCountRef = useRef(0);

  // Fetch users list
  useEffect(() => {
    async function fetchUsers() {
      setIsLoadingUsers(true);
      try {
        const res = await fetch("/api/users?pageSize=100&sortBy=created_at&sortOrder=desc");
        if (!res.ok) throw new Error("Failed to fetch users");
        const json = await res.json();
        if (json.success && json.data) {
          setUsers(json.data.data || json.data);
        }
      } catch (err) {
        console.error("Failed to fetch users:", err);
        toast.error("Tải danh sách người dùng thất bại");
      } finally {
        setIsLoadingUsers(false);
      }
    }
    fetchUsers();
  }, []);

  // Fetch messages for the selected user
  const fetchMessages = useCallback(async (userId: string) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        user_id: userId,
        page: "1",
        limit: "100",
      });
      const res = await fetch(`/api/chat?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch messages");
      const json = await res.json();
      if (json.success && json.data) {
        setMessages(json.data.messages || []);
      }
    } catch (err) {
      console.error("Failed to fetch messages:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Subscribe to realtime messages
  useEffect(() => {
    if (!selectedUserId) {
      setMessages([]);
      return;
    }

    fetchMessages(selectedUserId);

    const supabase = createClient();

    if (channelRef.current) {
      channelRef.current.unsubscribe();
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase
      .channel(`sim-chat-${selectedUserId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase JS realtime API does not export the literal union type for the event name
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
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [selectedUserId, fetchMessages]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevMessageCountRef.current = messages.length;
  }, [messages]);

  // Send a command to the simulator API
  const sendCommand = async (command: string) => {
    if (!selectedUserId) {
      toast.error("Hãy chọn người dùng trước");
      return;
    }
    setIsSending(true);
    try {
      const res = await fetch("/api/bot-simulator/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tele_user_id: selectedUserId, command }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || "Lệnh thất bại");
      }
    } catch (err) {
      console.error("Command error:", err);
      toast.error("Gửi lệnh thất bại");
    } finally {
      setIsSending(false);
    }
  };

  // Send a callback data to the simulator API
  const sendCallback = async (callbackData: string) => {
    if (!selectedUserId) return;
    setIsSending(true);
    try {
      const res = await fetch("/api/bot-simulator/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tele_user_id: selectedUserId,
          callback_data: callbackData,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || "Callback thất bại");
      }
    } catch (err) {
      console.error("Callback error:", err);
      toast.error("Gửi callback thất bại");
    } finally {
      setIsSending(false);
    }
  };

  // Handle custom command submit
  const handleCustomCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customCommand.trim()) return;
    const cmd = customCommand.trim().replace(/^\//, "");
    sendCommand(cmd);
    setCustomCommand("");
  };

  // Clear chat history for user
  const clearHistory = async () => {
    if (!selectedUserId) return;
    try {
      // We just clear local state; messages stay in DB for auditing
      setMessages([]);
      toast.success("Đã xoá lượt xem hội thoại");
    } catch {
      toast.error("Xoá lịch sử thất bại");
    }
  };

  // Get the selected user object
  const selectedUser = users.find((u) => u.id === selectedUserId);

  // Extract inline keyboard buttons from a message's raw_data
  function getInlineKeyboard(msg: ChatMessage): InlineButton[][] | null {
    const rawData = msg.raw_data as Record<string, unknown> | null;
    if (!rawData?.reply_markup) return null;
    const replyMarkup = rawData.reply_markup as Record<string, unknown>;
    const inlineKeyboard = replyMarkup.inline_keyboard as
      | InlineButton[][]
      | undefined;
    if (!inlineKeyboard || !Array.isArray(inlineKeyboard)) return null;
    return inlineKeyboard;
  }

  // Wave 22X — role gate (after all hooks, before JSX). Pre-fix any
  // viewer could fire commands as any tele_user via
  // /api/bot-simulator/command. Server still enforces; this hides
  // the affordance for viewers + adds explicit "no access" message.
  if (!canWrite) {
    return (
      <div className="flex h-[calc(100vh-4rem)] flex-col items-center justify-center gap-4 p-6">
        <BotSubTabs />
        <ShieldOff className="size-12 text-muted-foreground" />
        <h1 className="text-2xl font-bold tracking-tight">Không có quyền truy cập</h1>
        <p className="max-w-md text-center text-muted-foreground">
          Chỉ admin và super_admin mới có thể giả lập lệnh bot. Trang này
          có thể giả mạo hành động của người dùng Telegram nên cần quyền ghi.
        </p>
        <button
          onClick={() => router.push("/bot")}
          className="text-sm text-primary underline hover:no-underline"
        >
          Về Quản lý Bot
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col p-6">
      {/* Wave 22U — sub-tab of Quản lý Bot. */}
      <BotSubTabs />
      {/* Page Header */}
      <div className="mb-4 mt-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Terminal className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Test bot (giả lập)</h1>
          <p className="text-sm text-muted-foreground">
            Kiểm tra lệnh bot mà không gửi tin nhắn Telegram thật
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Left Panel: Controls */}
        <div className="flex w-72 shrink-0 flex-col gap-4">
          {/* User Selector */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                Chọn người dùng
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedUserId || ""}
                onValueChange={(val) => setSelectedUserId(val || null)}
                disabled={isLoadingUsers}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      isLoadingUsers ? "Đang tải..." : "Chọn người dùng..."
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      <span className="flex items-center gap-2">
                        {user.username
                          ? `@${user.username}`
                          : user.first_name || `ID: ${user.telegram_id}`}
                        <Badge
                          variant={
                            user.status === "active" ? "default" : "secondary"
                          }
                          className="ml-1 text-[10px]"
                        >
                          {user.status}
                        </Badge>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedUser && (
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <p>Telegram ID: {selectedUser.telegram_id}</p>
                  <p>Language: {selectedUser.language}</p>
                  <p>
                    Approval: {selectedUser.approval_mode}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Command Buttons */}
          <Card className="flex-1 overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Lệnh</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <ScrollArea className="h-[calc(100vh-28rem)]">
                <div className="grid grid-cols-2 gap-1.5">
                  {BOT_COMMANDS.map((cmd) => (
                    <Button
                      key={cmd.name}
                      variant="outline"
                      size="sm"
                      className="h-auto flex-col items-start px-2 py-1.5 text-left"
                      disabled={!selectedUserId || isSending}
                      onClick={() => sendCommand(cmd.name)}
                    >
                      <span className="font-mono text-xs font-semibold text-primary">
                        {cmd.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {cmd.description}
                      </span>
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Custom Command Input */}
          <Card>
            <CardContent className="p-3">
              <form onSubmit={handleCustomCommand} className="flex gap-2">
                <Input
                  value={customCommand}
                  onChange={(e) => setCustomCommand(e.target.value)}
                  placeholder="/command"
                  disabled={!selectedUserId || isSending}
                  className="flex-1 font-mono text-sm"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!selectedUserId || !customCommand.trim() || isSending}
                >
                  {isSending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Right Panel: Chat Window */}
        <Card className="min-w-0 flex-1 overflow-hidden">
          {!selectedUserId ? (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
              <Bot className="mb-3 h-12 w-12 opacity-30" />
              <p className="text-lg font-medium">Chọn người dùng</p>
              <p className="text-sm">
                Chọn người dùng từ thanh bên để bắt đầu giả lập
              </p>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              {/* Chat Header */}
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">
                      {selectedUser?.username
                        ? `@${selectedUser.username}`
                        : selectedUser?.first_name || "Unknown User"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Chế độ giả lập
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    <Play className="mr-1 h-2.5 w-2.5" />
                    SIMULATOR
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearHistory}
                  className="text-muted-foreground"
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Clear
                </Button>
              </div>

              {/* Messages Area */}
              <div
                ref={scrollRef}
                className="flex flex-1 flex-col overflow-y-auto px-4 py-4"
              >
                {isLoading ? (
                  <div className="flex flex-1 items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center text-muted-foreground">
                    <p className="text-sm">
                      Chưa có tin nhắn. Gửi lệnh để bắt đầu.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map((msg) => (
                      <SimulatorMessage
                        key={msg.id}
                        message={msg}
                        inlineKeyboard={getInlineKeyboard(msg)}
                        onCallbackClick={sendCallback}
                        isSending={isSending}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simulator message bubble with inline keyboard support
// ---------------------------------------------------------------------------

function SimulatorMessage({
  message,
  inlineKeyboard,
  onCallbackClick,
  isSending,
}: {
  message: ChatMessage;
  inlineKeyboard: InlineButton[][] | null;
  onCallbackClick: (data: string) => void;
  isSending: boolean;
}) {
  const isIncoming = message.direction === "incoming";
  const isSystem = message.message_type === "system";
  const isCommand = message.message_type === "command";
  const isCallback = message.message_type === "callback";

  // System messages render centered
  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <div className="flex items-center gap-1.5 rounded-full bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
          <Cog className="h-3 w-3" />
          {message.message_text || "[system message]"}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex items-end gap-2 ${
        isIncoming ? "justify-end" : "justify-start"
      }`}
    >
      {/* Bot avatar on left for outgoing (bot) messages */}
      {!isIncoming && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600">
          <Bot className="h-3.5 w-3.5 text-white" />
        </div>
      )}

      <div className="max-w-[70%]">
        {/* Message bubble */}
        <div
          className={`rounded-2xl px-3.5 py-2.5 ${
            isIncoming
              ? "rounded-br-md bg-muted text-foreground"
              : "rounded-bl-md bg-blue-600 text-white"
          }`}
        >
          {/* Message type badge */}
          {message.message_type !== "text" && (
            <div className="mb-1 flex items-center gap-1">
              <Badge
                variant="outline"
                className={`gap-1 text-[10px] ${
                  isIncoming ? "" : "border-blue-400 text-blue-200"
                }`}
              >
                {isCommand || isCallback ? (
                  <Terminal className="h-3 w-3" />
                ) : (
                  <MessageSquare className="h-3 w-3" />
                )}
                {message.message_type}
              </Badge>
            </div>
          )}

          {/* Message text */}
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {(isCommand || isCallback) && message.message_text ? (
              <span
                className={`font-mono font-semibold ${
                  isIncoming ? "text-primary" : "text-blue-200"
                }`}
              >
                {message.message_text}
              </span>
            ) : (
              message.message_text || (
                <span className="italic opacity-60">[no text content]</span>
              )
            )}
          </p>

          {/* Timestamp */}
          <p
            className={`mt-1 text-right text-[10px] ${
              isIncoming ? "text-muted-foreground" : "text-blue-200"
            }`}
          >
            {format(new Date(message.created_at), "HH:mm:ss")}
          </p>
        </div>

        {/* Inline Keyboard Buttons */}
        {inlineKeyboard && !isIncoming && (
          <div className="mt-1.5 space-y-1">
            {inlineKeyboard.map((row, rowIdx) => (
              <div key={rowIdx} className="flex gap-1">
                {row.map((btn, btnIdx) => (
                  <Button
                    key={btnIdx}
                    variant="outline"
                    size="sm"
                    className="h-8 flex-1 text-xs font-medium"
                    disabled={!btn.callback_data || isSending}
                    onClick={() => {
                      if (btn.callback_data) {
                        onCallbackClick(btn.callback_data);
                      }
                    }}
                  >
                    {btn.text}
                  </Button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* User avatar on right for incoming (user) messages */}
      {isIncoming && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
