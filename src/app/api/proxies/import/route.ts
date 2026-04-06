import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { ImportProxyResult } from "@/types/api";
import type { ProxyType } from "@/types/database";
import { requireAdminOrAbove } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { IMPORT_BATCH_SIZE } from "@/lib/constants";
import { ImportProxiesSchema } from "@/lib/validations";
import { captureError } from "@/lib/error-tracking";

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

    const importId = crypto.randomUUID();

    const result: ImportProxyResult & { importId: string } = {
      importId,
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
      // Process in batches using upsert to handle duplicates gracefully
      // This avoids the insert -> fail -> one-by-one fallback which is 100x slower
      for (let i = 0; i < validProxies.length; i += IMPORT_BATCH_SIZE) {
        const batch = validProxies.slice(i, i + IMPORT_BATCH_SIZE);
        const { error, count } = await supabase
          .from("proxies")
          .upsert(batch, { onConflict: "host,port", ignoreDuplicates: true, count: "exact" });

        if (error) {
          result.failed += batch.length;
          // Only store first 50 errors to avoid bloating response
          if (result.errors.length < 50) {
            result.errors.push({
              line: i + 1,
              raw: `batch ${Math.floor(i / IMPORT_BATCH_SIZE) + 1}`,
              reason: error.message,
            });
          }
        } else {
          const inserted = count ?? batch.length;
          result.imported += inserted;
          result.skipped += batch.length - inserted;
        }
      }
    }

    logActivity({
      actorType: "admin",
      actorId: admin.id,
      action: "proxy.import",
      resourceType: "proxy",
      details: {
        importId,
        total: result.total,
        imported: result.imported,
        failed: result.failed,
        skipped: result.skipped,
      },
      ipAddress: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    }).catch((err) => captureError(err, { source: "api.proxies.import.log", extra: { adminId: admin.id } }));

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    captureError(error, { source: "api.proxies.import", extra: { adminId: admin?.id } });
    return NextResponse.json(
      { success: false, error: "Failed to import proxies" },
      { status: 500 }
    );
  }
}
