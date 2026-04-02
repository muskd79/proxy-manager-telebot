import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ApiResponse } from "@/types/api";
import type { ChatMessage, TeleUser } from "@/types/database";
import { requireAnyRole } from "@/lib/auth";

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
    // Get all users who have chat messages, with their latest message
    const { data: usersWithMessages, error: usersError } = await supabase
      .from("tele_users")
      .select("*")
      .eq("is_deleted", false);

    if (usersError) {
      return NextResponse.json(
        { success: false, error: usersError.message } satisfies ApiResponse<never>,
        { status: 500 }
      );
    }

    const conversations: ConversationResponse[] = [];

    for (const teleUser of usersWithMessages ?? []) {
      // Get the latest message for each user
      const { data: lastMessages } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("tele_user_id", teleUser.id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (lastMessages && lastMessages.length > 0) {
        conversations.push({
          user: teleUser,
          lastMessage: lastMessages[0],
          unreadCount: 0, // Placeholder - implement with read receipts if needed
        });
      }
    }

    // Sort by latest message timestamp
    conversations.sort((a, b) => {
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
