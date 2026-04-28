"use client";

/**
 * Wave 22U — /bot/config Phase 1 stub.
 *
 * Phase 2 plan (Wave 22V): pull these settings out of /settings into
 * a focused bot-config UI:
 *   - Webhook URL + secret rotation
 *   - Telegram bot token (rotate, validate)
 *   - Command list (enable/disable, edit help text)
 *   - Per-user / per-IP rate-limit tuning
 *   - IP whitelist (Telegram source IPs)
 *   - Ban list management (block_list table)
 *   - Auto-response templates
 *
 * For now this page is a placeholder so the BotSubTabs nav doesn't
 * 404. Linking to /settings keeps the existing config reachable.
 */

import Link from "next/link";
import { Cog, Settings, ExternalLink } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BotSubTabs } from "@/components/bot/bot-sub-tabs";

export default function BotConfigPage() {
  return (
    <div className="flex-1 space-y-6 p-6">
      <BotSubTabs />

      <div className="mt-2 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Cog className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cấu hình bot</h1>
          <p className="text-sm text-muted-foreground">
            Webhook, lệnh, rate-limit, danh sách chặn. Wave 22V đang phát triển.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sắp ra mắt — Wave 22V</CardTitle>
          <CardDescription className="leading-relaxed">
            Bot config sẽ có giao diện chuyên dụng. Hiện tại các thiết lập
            liên quan đến bot vẫn nằm trong trang Cài đặt chung.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Webhook URL + xoay secret</li>
            <li>Bot token (xác thực, xoay)</li>
            <li>Bật/tắt từng lệnh + sửa help text</li>
            <li>Rate-limit per-user / per-IP</li>
            <li>IP allowlist của Telegram (đã hardcode trong Wave 17)</li>
            <li>Block list + auto-response templates</li>
          </ul>
          <Link href="/settings">
            <Button variant="outline">
              <Settings className="mr-2 h-4 w-4" />
              Mở Cài đặt chung
              <ExternalLink className="ml-2 h-3.5 w-3.5" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
