import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ApiResponse } from "@/types/api";
import type { ChatMessage, TeleUser } from "@/types/database";
import { requireAnyRole, requireAdminOrAbove } from "@/lib/auth";
import { sendTelegramMessage } from "@/lib/telegram/send";

interface ConversationResponse {
  user: TeleUser;
  lastMessage: ChatMessage | null;
  unreadCount: number;
}

interface MessagesResponse {
  messages: ChatMessage[];
  hasMore: boolean;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { admin, error: authError } = await requireAnyRole(supabase);
    if (authError) return authError;

    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get("user_id");
    const page = Number(searchParams.get("page")) || 1;
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);

    // If user_id is provided, return messages for that user
    if (userId) {
      const offset = (page - 1) * limit;

      const { data: messages, error, count } = await supabase
        .from("chat_messages")
        .select("*", { count: "exact" })
        .eq("tele_user_id", userId)
        .order("created_at", { ascending: true })
        .range(offset, offset + limit - 1);

      if (error) {
        return NextResponse.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          { status: 500 }
        );
      }

      const total = count ?? 0;
      const response: ApiResponse<MessagesResponse> = {
        success: true,
        data: {
          messages: messages ?? [],
          hasMore: offset + limit < total,
        },
      };

      return NextResponse.json(response);
    }

    // Otherwise, return conversation list
    // Use a single query: get all messages with user info, then deduplicate to latest per user
    const { data: allMessages, error: convError } = await supabase
      .from("chat_messages")
      .select("*, tele_users!inner(id, username, first_name, last_name, telegram_id, status, is_deleted)")
      .eq("tele_users.is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(5000); // Limit to last 5000 messages for performance

    if (convError) {
      return NextResponse.json(
        { success: false, error: convError.message } satisfies ApiResponse<never>,
        { status: 500 }
      );
    }

    // Group by user, keep only latest message per user
    const userMap = new Map<string, ConversationResponse>();
    for (const msg of allMessages || []) {
      if (!userMap.has(msg.tele_user_id)) {
        const teleUser = msg.tele_users as unknown as TeleUser;
        userMap.set(msg.tele_user_id, {
          user: teleUser,
          lastMessage: {
            id: msg.id,
            tele_user_id: msg.tele_user_id,
            telegram_message_id: msg.telegram_message_id,
            direction: msg.direction,
            message_text: msg.message_text,
            message_type: msg.message_type,
            raw_data: msg.raw_data,
            created_at: msg.created_at,
          } as ChatMessage,
          unreadCount: 0,
        });
      }
    }

    const conversations = Array.from(userMap.values())
      .sort((a, b) => {
        const aTime = a.lastMessage?.created_at ?? "";
        const bTime = b.lastMessage?.created_at ?? "";
        return bTime.localeCompare(aTime);
      });

    const response: ApiResponse<ConversationResponse[]> = {
      success: true,
      data: conversations,
    };

    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  const body = await request.json();
  const { tele_user_id, message } = body;

  if (!tele_user_id || !message) {
    return NextResponse.json({ success: false, error: "tele_user_id and message required" }, { status: 400 });
  }

  // Get user's telegram_id
  const { data: teleUser } = await supabase
    .from("tele_users")
    .select("telegram_id")
    .eq("id", tele_user_id)
    .single();

  if (!teleUser) {
    return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
  }

  // Send via Telegram Bot API
  const result = await sendTelegramMessage(teleUser.telegram_id, message);
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error || "Failed to send" }, { status: 500 });
  }

  // Log message in chat_messages
  await supabase.from("chat_messages").insert({
    tele_user_id,
    telegram_message_id: null,
    direction: "outgoing",
    message_text: message,
    message_type: "text",
    raw_data: null,
  });

  // Log activity
  const { logActivity } = await import("@/lib/logger");
  logActivity({
    actorType: "admin",
    actorId: admin.id,
    action: "chat.reply",
    resourceType: "tele_user",
    resourceId: tele_user_id,
    details: { message: message.substring(0, 100) },
  }).catch(console.error);

  return NextResponse.json({ success: true });
}
