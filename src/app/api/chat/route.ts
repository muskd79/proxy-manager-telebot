import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ApiResponse } from "@/types/api";
import type { ChatMessage, TeleUser } from "@/types/database";
import { requireAnyRole, requireAdminOrAbove, actorLabel } from "@/lib/auth";
import { sendTelegramMessage } from "@/lib/telegram/send";
import { SendChatMessageSchema } from "@/lib/validations";
import { assertSameOrigin } from "@/lib/csrf";

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

    // Wave 22D-4 BUG FIX (HIGH): pre-22D-4 fetched the latest 5000
    // chat_messages into Lambda memory and deduped client-side. Two
    // problems:
    //   1. OOM risk at scale.
    //   2. CORRECTNESS: a single chatty user (>5,000 msgs) dominated
    //      the recency window — quieter users were silently dropped
    //      from the conversation list, never to be seen again.
    //
    // Mig 033 added the get_recent_conversations RPC which does the
    // dedup in SQL via DISTINCT ON (tele_user_id) — memory is now
    // O(distinct_users), and the search filter applies BEFORE dedup
    // so a user's latest matching message wins (not "the user's
    // latest message, if it happens to match"). Pagination via
    // simple OFFSET — fine because the result set is bounded by
    // user count, not message count.
    const search = searchParams.get("search");
    const offset = (page - 1) * limit;

    const { data, error: convError } = await supabase.rpc(
      "get_recent_conversations",
      {
        p_limit: limit,
        p_offset: offset,
        p_search: search || null,
      },
    );

    if (convError) {
      return NextResponse.json(
        { success: false, error: convError.message } satisfies ApiResponse<never>,
        { status: 500 }
      );
    }

    type ConversationRow = {
      msg_id: string;
      tele_user_id: string;
      telegram_message_id: number | null;
      direction: ChatMessage["direction"];
      message_text: string | null;
      message_type: ChatMessage["message_type"];
      raw_data: Record<string, unknown> | null;
      msg_created_at: string;
      user_id: string;
      username: string | null;
      first_name: string | null;
      last_name: string | null;
      telegram_id: number;
      status: TeleUser["status"];
      total_count: string | number;
    };
    const rows = (data ?? []) as ConversationRow[];

    const conversations: ConversationResponse[] = rows.map((row) => ({
      user: {
        id: row.user_id,
        username: row.username,
        first_name: row.first_name,
        last_name: row.last_name,
        telegram_id: row.telegram_id,
        status: row.status,
      } as TeleUser,
      lastMessage: {
        id: row.msg_id,
        tele_user_id: row.tele_user_id,
        telegram_message_id: row.telegram_message_id,
        direction: row.direction,
        message_text: row.message_text,
        message_type: row.message_type,
        raw_data: row.raw_data,
        created_at: row.msg_created_at,
      } as ChatMessage,
      unreadCount: 0,
    }));

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
  const csrfErr = assertSameOrigin(request);
  if (csrfErr) return csrfErr;

  const supabase = await createClient();
  const { admin, error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  const body = await request.json();
  const parsed = SendChatMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { tele_user_id, message } = parsed.data;

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
    actorDisplayName: actorLabel(admin),
    action: "chat.reply",
    resourceType: "tele_user",
    resourceId: tele_user_id,
    details: { message: message.substring(0, 100) },
  }).catch(console.error);

  return NextResponse.json({ success: true });
}
