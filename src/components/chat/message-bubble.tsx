"use client";

import { format } from "date-fns";
import { Bot, User, Terminal, MessageSquare, Image, FileText, Cog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ChatMessage, ChatDirection, MessageType } from "@/types/database";

interface MessageBubbleProps {
  message: ChatMessage;
}

const messageTypeIcons: Record<string, React.ReactNode> = {
  command: <Terminal className="h-3 w-3" />,
  text: <MessageSquare className="h-3 w-3" />,
  photo: <Image className="h-3 w-3" />,
  document: <FileText className="h-3 w-3" />,
  system: <Cog className="h-3 w-3" />,
  callback: <Cog className="h-3 w-3" />,
};

export function MessageBubble({ message }: MessageBubbleProps) {
  const isIncoming = message.direction === "incoming";
  const isCommand = message.message_type === "command";
  const isSystem = message.message_type === "system";

  // System messages render differently
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
        isIncoming ? "justify-start" : "justify-end"
      }`}
    >
      {isIncoming && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      )}

      <div
        className={`max-w-[70%] rounded-2xl px-3.5 py-2.5 ${
          isIncoming
            ? "rounded-bl-md bg-muted text-foreground"
            : "rounded-br-md bg-blue-600 text-white"
        }`}
      >
        {/* Message type indicator */}
        {message.message_type !== "text" && (
          <div className="mb-1 flex items-center gap-1">
            <Badge
              variant="outline"
              className={`gap-1 text-[10px] ${
                isIncoming ? "" : "border-blue-400 text-blue-200"
              }`}
            >
              {messageTypeIcons[message.message_type]}
              {message.message_type}
            </Badge>
          </div>
        )}

        {/* Message text with command highlighting */}
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {isCommand && message.message_text ? (
            <span className="font-mono font-semibold text-blue-300">
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
          {format(new Date(message.created_at), "HH:mm")}
        </p>
      </div>

      {!isIncoming && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600">
          <Bot className="h-3.5 w-3.5 text-white" />
        </div>
      )}
    </div>
  );
}
