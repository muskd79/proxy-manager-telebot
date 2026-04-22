/**
 * Vercel Cron entrypoint for the vendor outbox drain.
 *
 * Schedule: `* * * * *` (every minute) in vercel.json.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` — Vercel Cron sets this
 * header automatically when the project has a CRON_SECRET env. Manual
 * triggers from an admin UI must include the same secret OR come from
 * an authenticated super_admin session (see dual-auth pattern below).
 */

import { NextRequest, NextResponse } from "next/server";
import { drainOutbox } from "@/lib/vendors/saga/drain";
import { buildVendorCtx } from "@/lib/vendors/ctx";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { timingSafeEqual } from "crypto";

function safeCompare(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

async function runDrain(workerId: string) {
  const result = await drainOutbox(
    {
      supabase: supabaseAdmin,
      resolveVendor: async (vendorId: string) => {
        const resolved = await buildVendorCtx(vendorId);
        return {
          adapter: resolved.adapter,
          ctx: resolved.ctx,
          vendor: { slug: resolved.vendor.slug },
        };
      },
      now: () => new Date(),
      workerId,
    },
    20,
  );
  return result;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }

  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!safeCompare(token, secret)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const workerId = `vercel:${req.headers.get("x-vercel-id") ?? Date.now()}`;
  try {
    const result = await runDrain(workerId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error(
      "outbox-drain error:",
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json(
      { ok: false, error: "drain_failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  // Reuse the GET handler — Vercel Cron may use either.
  return GET(req);
}
