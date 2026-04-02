import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { ImportProxyResult } from "@/types/api";
import type { ProxyType } from "@/types/database";
import { requireAdminOrAbove } from "@/lib/auth";
import { logActivity } from "@/lib/logger";

interface ImportProxyRow {
  host: string;
  port: number;
  type: ProxyType;
  username?: string;
  password?: string;
  country?: string;
  line?: number;
  raw?: string;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { admin, error: authError } = await requireAdminOrAbove(supabase);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { proxies, type, country } = body as {
      proxies: ImportProxyRow[];
      type?: ProxyType;
      country?: string;
    };

    if (!proxies || !Array.isArray(proxies) || proxies.length === 0) {
      return NextResponse.json(
        { error: "proxies array is required and must not be empty" },
        { status: 400 }
      );
    }

    const result: ImportProxyResult = {
      total: proxies.length,
      imported: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    const validProxies: Array<Record<string, unknown>> = [];

    for (let i = 0; i < proxies.length; i++) {
      const proxy = proxies[i];

      if (!proxy.host || !proxy.port) {
        result.failed++;
        result.errors.push({
          line: proxy.line ?? i + 1,
          raw: proxy.raw ?? `${proxy.host}:${proxy.port}`,
          reason: "Missing host or port",
        });
        continue;
      }

      if (proxy.port < 1 || proxy.port > 65535) {
        result.failed++;
        result.errors.push({
          line: proxy.line ?? i + 1,
          raw: proxy.raw ?? `${proxy.host}:${proxy.port}`,
          reason: "Invalid port number",
        });
        continue;
      }

      validProxies.push({
        host: proxy.host,
        port: proxy.port,
        type: proxy.type || type || "http",
        username: proxy.username || null,
        password: proxy.password || null,
        country: proxy.country || country || null,
        status: "available",
        is_deleted: false,
        created_by: admin.id,
      });
    }

    if (validProxies.length > 0) {
      // Insert in batches of 100
      const batchSize = 100;
      for (let i = 0; i < validProxies.length; i += batchSize) {
        const batch = validProxies.slice(i, i + batchSize);
        const { error } = await supabase
          .from("proxies")
          .insert(batch);

        if (error) {
          // Count all remaining as failed
          result.failed += batch.length;
          result.errors.push({
            line: i + 1,
            raw: `Batch ${Math.floor(i / batchSize) + 1}`,
            reason: error.message,
          });
        } else {
          result.imported += batch.length;
        }
      }
    }

    result.skipped = result.total - result.imported - result.failed;

    logActivity({
      actorType: "admin",
      actorId: admin.id,
      action: "proxy.import",
      resourceType: "proxy",
      details: {
        total: result.total,
        imported: result.imported,
        failed: result.failed,
        skipped: result.skipped,
      },
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    }).catch(console.error);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: "Failed to import proxies" },
      { status: 500 }
    );
  }
}
