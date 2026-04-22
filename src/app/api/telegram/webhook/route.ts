import { NextRequest, NextResponse } from "next/server";
import { webhookCallback } from "@/lib/telegram/bot";
import "@/lib/telegram/handlers"; // register all handlers
import { bot } from "@/lib/telegram/handlers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { captureError } from "@/lib/error-tracking";
import { acquireSlot, releaseSlot } from "@/lib/telegram/webhook-queue";
import { isTelegramIp } from "@/lib/telegram/ip-whitelist";
import { getClientIp } from "@/lib/ip";

// === Layer 1: In-memory dedup (fast, covers warm instances) ===
const processedUpdates = new Set<number>();
const MAX_DEDUP_SIZE = 1000;

// === Per-user rate limiting (in-memory, 30 req/min per user) ===
const webhookRateLimits = new Map<
  number,
  { count: number; resetAt: number }
>();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

// Periodic cleanup counter for old dedup entries
let dedupCleanupCounter = 0;
const DEDUP_CLEANUP_INTERVAL = 100; // Clean up every 100 requests

/**
 * Check DB-backed dedup table for update_id.
 * Returns true if already processed.
 */
async function isDuplicateInDb(updateId: number): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from("webhook_dedup")
      .select("update_id")
      .eq("update_id", updateId)
      .maybeSingle();
    return !!data;
  } catch {
    // On DB error, allow processing (fail open)
    return false;
  }
}

/**
 * Record update_id in DB dedup table after successful processing.
 */
async function recordProcessedUpdate(updateId: number): Promise<void> {
  try {
    await supabaseAdmin
      .from("webhook_dedup")
      .upsert({ update_id: updateId }, { onConflict: "update_id" });
  } catch {
    // Non-critical: if insert fails, next cold start may reprocess
    console.warn("Failed to record dedup for update_id:", updateId);
  }
}

/**
 * Periodically clean up dedup entries older than 24 hours.
 */
async function cleanupOldDedupEntries(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from("webhook_dedup")
      .delete()
      .lt("processed_at", cutoff);
  } catch {
    // Non-critical cleanup
  }
}

export async function GET() {
  return NextResponse.json({ status: "ok", webhook: "active" });
}

export async function POST(req: NextRequest) {
  // Verify Telegram webhook secret (required)
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!webhookSecret) {
    captureError(new Error("TELEGRAM_WEBHOOK_SECRET not configured"), { source: "webhook.config" });
    return NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 500 });
  }

  const headerSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (headerSecret !== webhookSecret) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  // Defense-in-depth: reject traffic from IPs outside Telegram's CIDR ranges.
  // Set SKIP_TELEGRAM_IP_CHECK=true to bypass if Telegram publishes new ranges.
  const clientIp = getClientIp(req);
  if (!isTelegramIp(clientIp)) {
    captureError(new Error("Non-Telegram IP hit webhook"), {
      source: "webhook.ip",
      extra: { ip: clientIp },
    });
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  try {
    const body = await req.clone().json();
    const updateId = body?.update_id;

    // === Per-user rate limiting ===
    const chatId =
      body?.message?.chat?.id || body?.callback_query?.message?.chat?.id;
    if (chatId) {
      const now = Date.now();
      const userLimit = webhookRateLimits.get(chatId);
      if (userLimit && userLimit.count >= RATE_LIMIT_MAX && userLimit.resetAt > now) {
        // Rate limited - silently acknowledge to Telegram
        return NextResponse.json({ ok: true });
      }
      // Track request count
      if (!userLimit || userLimit.resetAt <= now) {
        webhookRateLimits.set(chatId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      } else {
        userLimit.count++;
      }
    }

    // === Layer 1: In-memory dedup (fast check) ===
    if (updateId && processedUpdates.has(updateId)) {
      return NextResponse.json({ ok: true }); // Already processed
    }

    // === Layer 2: DB-backed dedup (survives cold starts) ===
    if (updateId && (await isDuplicateInDb(updateId))) {
      // Add to in-memory cache so subsequent hits are fast
      processedUpdates.add(updateId);
      return NextResponse.json({ ok: true }); // Already processed
    }

    // Mark in memory before processing
    if (updateId) {
      processedUpdates.add(updateId);
      // Keep set bounded
      if (processedUpdates.size > MAX_DEDUP_SIZE) {
        const first = processedUpdates.values().next().value;
        if (first !== undefined) processedUpdates.delete(first);
      }
    }

    // Acquire a slot from the connection pool queue (max 50 concurrent)
    // This prevents connection pool exhaustion under high load
    try {
      await acquireSlot();
    } catch {
      // Queue timeout - return ok to Telegram so it doesn't retry
      return NextResponse.json({ ok: true });
    }

    try {
      // Process the update
      const handler = webhookCallback(bot, "std/http");
      const response = await handler(req);

      // Record in DB after successful processing
      if (updateId) {
        // Fire-and-forget: don't block the response
        recordProcessedUpdate(updateId);
      }

      // Periodic cleanup of old dedup entries
      dedupCleanupCounter++;
      if (dedupCleanupCounter >= DEDUP_CLEANUP_INTERVAL) {
        dedupCleanupCounter = 0;
        cleanupOldDedupEntries();
      }

      return response;
    } finally {
      releaseSlot();
    }
  } catch (error) {
    captureError(error, { source: "webhook.process", extra: { method: "POST" } });
    return NextResponse.json({ ok: true });
  }
}
