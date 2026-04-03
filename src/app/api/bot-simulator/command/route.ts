import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdminOrAbove } from "@/lib/auth";
import { createSimulatorContext } from "@/lib/telegram/simulator";
import type { SupportedLanguage } from "@/types/telegram";

// Import all command handlers
import {
  handleStart,
  handleGetProxy,
  handleMyProxies,
  handleStatus,
  handleRevoke,
  handleCancel,
  handleLanguage,
  handleHelp,
  handleUnknownCommand,
  handleCheckProxy,
  handleHistory,
  handleSupport,
  handleAdminRequests,
  handleProxyTypeSelection,
  handleLanguageSelection,
  handleRevokeSelection,
  handleAdminApproveCallback,
  handleAdminRejectCallback,
  handleAdminApproveUser,
  handleAdminBlockUser,
} from "@/lib/telegram/commands";
import {
  handleQuantitySelection,
  handleAdminBulkApproveCallback,
  handleAdminBulkRejectCallback,
} from "@/lib/telegram/commands/bulk-proxy";

// Map command names to their handler functions
const COMMAND_MAP: Record<string, (ctx: import("grammy").Context) => Promise<void>> = {
  start: handleStart,
  getproxy: handleGetProxy,
  myproxies: handleMyProxies,
  status: handleStatus,
  revoke: handleRevoke,
  cancel: handleCancel,
  language: handleLanguage,
  help: handleHelp,
  checkproxy: handleCheckProxy,
  history: handleHistory,
  support: handleSupport,
  requests: handleAdminRequests,
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  const body = await request.json();
  const { tele_user_id, command, callback_data } = body as {
    tele_user_id: string;
    command?: string;
    callback_data?: string;
  };

  if (!tele_user_id) {
    return NextResponse.json(
      { success: false, error: "tele_user_id is required" },
      { status: 400 }
    );
  }

  if (!command && !callback_data) {
    return NextResponse.json(
      { success: false, error: "command or callback_data is required" },
      { status: 400 }
    );
  }

  // Fetch the target user
  const { data: user } = await supabaseAdmin
    .from("tele_users")
    .select("*")
    .eq("id", tele_user_id)
    .single();

  if (!user) {
    return NextResponse.json(
      { success: false, error: "User not found" },
      { status: 404 }
    );
  }

  // Log incoming message from the simulated user
  await supabaseAdmin.from("chat_messages").insert({
    tele_user_id: user.id,
    telegram_message_id: null,
    direction: "incoming",
    message_text: command ? `/${command}` : callback_data || "",
    message_type: command ? "command" : "callback",
    raw_data: null,
  });

  // Create mock Grammy context
  const ctx = createSimulatorContext(user, {
    command: command ? `/${command}` : undefined,
    callbackData: callback_data,
  });

  try {
    if (command) {
      const handler = COMMAND_MAP[command];
      if (handler) {
        await handler(ctx);
      } else {
        // Unknown command
        await handleUnknownCommand(ctx);
      }
    } else if (callback_data) {
      await routeCallback(ctx, callback_data);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Simulator error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Handler error",
      },
      { status: 500 }
    );
  }
}

/**
 * Route callback data to the appropriate handler,
 * mirroring the logic in src/lib/telegram/handlers.ts
 */
async function routeCallback(ctx: import("grammy").Context, data: string) {
  if (data.startsWith("proxy_type:")) {
    const proxyType = data.replace("proxy_type:", "");
    await handleProxyTypeSelection(ctx, proxyType);
    return;
  }

  if (data.startsWith("lang:")) {
    const lang = data.replace("lang:", "") as SupportedLanguage;
    await handleLanguageSelection(ctx, lang);
    return;
  }

  if (data.startsWith("revoke:")) {
    const proxyId = data.replace("revoke:", "");
    await handleRevokeSelection(ctx, proxyId);
    return;
  }

  if (data.startsWith("admin_approve:")) {
    const requestId = data.replace("admin_approve:", "");
    await handleAdminApproveCallback(ctx, requestId);
    return;
  }

  if (data.startsWith("admin_reject:")) {
    const requestId = data.replace("admin_reject:", "");
    await handleAdminRejectCallback(ctx, requestId);
    return;
  }

  if (data.startsWith("admin_approve_user:")) {
    const userId = data.replace("admin_approve_user:", "");
    await handleAdminApproveUser(ctx, userId);
    return;
  }

  if (data.startsWith("admin_block_user:")) {
    const userId = data.replace("admin_block_user:", "");
    await handleAdminBlockUser(ctx, userId);
    return;
  }

  if (data.startsWith("qty:")) {
    const parts = data.split(":");
    const proxyType = parts[1];
    const quantity = parseInt(parts[2], 10);
    if (proxyType && !isNaN(quantity) && quantity > 0) {
      await handleQuantitySelection(ctx, proxyType, quantity);
    }
    return;
  }

  if (data.startsWith("admin_bulk_approve:")) {
    const requestId = data.replace("admin_bulk_approve:", "");
    await handleAdminBulkApproveCallback(ctx, requestId);
    return;
  }

  if (data.startsWith("admin_bulk_reject:")) {
    const requestId = data.replace("admin_bulk_reject:", "");
    await handleAdminBulkRejectCallback(ctx, requestId);
    return;
  }
}
