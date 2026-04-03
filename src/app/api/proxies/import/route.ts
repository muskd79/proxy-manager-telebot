import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { ImportProxyResult } from "@/types/api";
import type { ProxyType } from "@/types/database";
import { requireAdminOrAbove } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { IMPORT_BATCH_SIZE } from "@/lib/constants";
import { ImportProxiesSchema } from "@/lib/validations";

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
    const parsed = ImportProxiesSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { proxies, type, country, tags, notes, isp } = parsed.data;

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
        tags: tags || null,
        notes: notes || null,
        isp: isp || null,
        status: "available",
        is_deleted: false,
        created_by: admin.id,
      });
    }

    if (validProxies.length > 0) {
      // Process in batches with fallback to one-by-one on failure
      for (let i = 0; i < validProxies.length; i += IMPORT_BATCH_SIZE) {
        const batch = validProxies.slice(i, i + IMPORT_BATCH_SIZE);
        const { error } = await supabase
          .from("proxies")
          .insert(batch);

        if (!error) {
          result.imported += batch.length;
        } else {
          // Batch failed – try one by one to identify specific failures
          for (let j = 0; j < batch.length; j++) {
            const item = batch[j];
            const { error: singleError } = await supabase
              .from("proxies")
              .insert(item);

            if (singleError) {
              const lineNum = proxies[i + j]?.line ?? i + j + 1;
              const rawStr = `${item.host}:${item.port}`;
              if (
                singleError.message.includes("duplicate") ||
                singleError.message.includes("unique")
              ) {
                result.skipped++;
                result.errors.push({
                  line: lineNum,
                  raw: rawStr,
                  reason: "Duplicate proxy",
                });
              } else {
                result.failed++;
                result.errors.push({
                  line: lineNum,
                  raw: rawStr,
                  reason: singleError.message,
                });
              }
            } else {
              result.imported++;
            }
          }
        }
      }
    }

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
      { success: false, error: "Failed to import proxies" },
      { status: 500 }
    );
  }
}
