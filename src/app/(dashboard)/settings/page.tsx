"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Save, RefreshCw, Wifi, WifiOff, Copy, ShieldOff, Users } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useRole } from "@/lib/role-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

interface SettingsForm {
  default_rate_limit_hourly: number;
  default_rate_limit_daily: number;
  default_rate_limit_total: number;
  default_approval_mode: "auto" | "manual";
  auto_clean_trash_days: number;
  telegram_bot_token: string;
  telegram_webhook_secret: string;
  webhook_url: string;
  global_max_proxies: number;
  global_max_total_requests: number;
  admin_telegram_ids: string;
}

export default function SettingsPage() {
  const { canManageSettings } = useRole();
  const router = useRouter();
  const [settings, setSettings] = useState<SettingsForm>({
    default_rate_limit_hourly: 3,
    default_rate_limit_daily: 10,
    default_rate_limit_total: 50,
    default_approval_mode: "auto",
    auto_clean_trash_days: 30,
    telegram_bot_token: "",
    telegram_webhook_secret: "",
    webhook_url: "",
    global_max_proxies: 5,
    global_max_total_requests: 100,
    admin_telegram_ids: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applyToExisting, setApplyToExisting] = useState(false);
  // Wave 22X — confirm-before-save when applying to existing users.
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [testingBot, setTestingBot] = useState(false);
  const [botConnected, setBotConnected] = useState<boolean | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const result = await res.json();
        if (result.data) {
          // Merge loaded settings into form
          const loaded: Record<string, unknown> = {};
          for (const setting of result.data as Array<{
            key: string;
            value: Record<string, unknown>;
          }>) {
            loaded[setting.key] = setting.value?.value ?? setting.value;
          }
          setSettings((prev) => ({
            ...prev,
            default_rate_limit_hourly:
              (loaded.default_rate_limit_hourly as number) ??
              prev.default_rate_limit_hourly,
            default_rate_limit_daily:
              (loaded.default_rate_limit_daily as number) ??
              prev.default_rate_limit_daily,
            default_rate_limit_total:
              (loaded.default_rate_limit_total as number) ??
              prev.default_rate_limit_total,
            default_approval_mode:
              (loaded.default_approval_mode as "auto" | "manual") ??
              prev.default_approval_mode,
            auto_clean_trash_days:
              (loaded.auto_clean_trash_days as number) ??
              prev.auto_clean_trash_days,
            telegram_bot_token:
              (loaded.telegram_bot_token as string) ??
              prev.telegram_bot_token,
            telegram_webhook_secret:
              (loaded.telegram_webhook_secret as string) ??
              prev.telegram_webhook_secret,
            webhook_url:
              (loaded.webhook_url as string) ?? prev.webhook_url,
            global_max_proxies:
              (loaded.global_max_proxies as number) ??
              prev.global_max_proxies,
            global_max_total_requests:
              (loaded.global_max_total_requests as number) ??
              prev.global_max_total_requests,
            admin_telegram_ids:
              loaded.admin_telegram_ids
                ? Array.isArray(loaded.admin_telegram_ids)
                  ? (loaded.admin_telegram_ids as number[]).join(", ")
                  : String(loaded.admin_telegram_ids)
                : prev.admin_telegram_ids,
          }));
        }
      }
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Wave 22X — confirm-then-save when applyToExisting is checked.
  // Pre-fix: one click silently mutated rate limits for EVERY existing
  // bot user (could be thousands). Now show DangerousConfirmDialog.
  const requestSave = () => {
    if (applyToExisting) {
      setShowApplyConfirm(true);
    } else {
      handleSave();
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setShowApplyConfirm(false);
    try {
      // Transform admin_telegram_ids from comma-separated string to number array
      const settingsToSave = {
        ...settings,
        admin_telegram_ids: settings.admin_telegram_ids
          ? settings.admin_telegram_ids
              .split(",")
              .map((s) => parseInt(s.trim()))
              .filter((n) => !isNaN(n))
          : [],
      };
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_settings",
          settings: settingsToSave,
          applyToExisting,
        }),
      });
      if (res.ok) {
        toast.success("Đã lưu cài đặt");
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to save settings");
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleTestBot = async () => {
    setTestingBot(true);
    setBotConnected(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test_bot_connection" }),
      });
      if (res.ok) {
        const result = await res.json();
        setBotConnected(result.connected ?? false);
        toast.success(
          result.connected ? "Bot is connected!" : "Bot connection failed"
        );
      } else {
        setBotConnected(false);
        toast.error("Kết nối bot thất bại");
      }
    } catch (err) {
      console.error("Bot connection test failed:", err);
      setBotConnected(false);
      toast.error("Kết nối bot thất bại");
    } finally {
      setTestingBot(false);
    }
  };

  const maskToken = (token: string) => {
    if (!token || token.length < 10) return token;
    return token.slice(0, 6) + "..." + token.slice(-4);
  };

  const copyWebhookUrl = () => {
    if (settings.webhook_url) {
      navigator.clipboard.writeText(settings.webhook_url);
      toast.success("Đã chép URL webhook");
    }
  };

  if (!canManageSettings) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <ShieldOff className="size-12 text-muted-foreground" />
        <h1 className="text-2xl font-bold tracking-tight">Không có quyền truy cập</h1>
        <p className="text-muted-foreground">
          You do not have permission to manage settings. Only super admins can access this page.
        </p>
        <button
          onClick={() => router.push("/dashboard")}
          className="text-sm text-primary underline hover:no-underline"
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 space-y-6 p-6">
        <h1 className="text-2xl font-bold tracking-tight">Cài đặt</h1>
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cài đặt</h1>
          <p className="text-muted-foreground">
            System configuration and preferences
          </p>
        </div>
        <Button onClick={requestSave} disabled={saving}>
          <Save className="size-4 mr-1.5" />
          {saving ? "Đang lưu..." : "Lưu cài đặt"}
        </Button>
      </div>

      {/* Giới hạn mặc định */}
      <Card>
        <CardHeader>
          <CardTitle>Giới hạn mặc định</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Default rate limits applied to new Telegram users.
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="hourly">Giới hạn / giờ</Label>
              <Input
                id="hourly"
                type="number"
                min={0}
                value={settings.default_rate_limit_hourly}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    default_rate_limit_hourly: parseInt(e.target.value) || 0,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="daily">Giới hạn / ngày</Label>
              <Input
                id="daily"
                type="number"
                min={0}
                value={settings.default_rate_limit_daily}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    default_rate_limit_daily: parseInt(e.target.value) || 0,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="total">Tổng giới hạn</Label>
              <Input
                id="total"
                type="number"
                min={0}
                value={settings.default_rate_limit_total}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    default_rate_limit_total: parseInt(e.target.value) || 0,
                  }))
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Giới hạn toàn cục */}
      <Card>
        <CardHeader>
          <CardTitle>Giới hạn toàn cục</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Hard caps applied to all users who have not been given custom limits.
            These override per-user defaults as upper bounds.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="global-max-proxies">
                Global Max Proxies Per User
              </Label>
              <Input
                id="global-max-proxies"
                type="number"
                min={1}
                value={settings.global_max_proxies}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    global_max_proxies: parseInt(e.target.value) || 5,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="global-max-total">
                Global Max Total Requests
              </Label>
              <Input
                id="global-max-total"
                type="number"
                min={1}
                value={settings.global_max_total_requests}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    global_max_total_requests: parseInt(e.target.value) || 100,
                  }))
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Approval Mode */}
      <Card>
        <CardHeader>
          <CardTitle>Chế độ duyệt mặc định</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            How proxy requests are handled by default for new users.
          </p>
          <Select
            value={settings.default_approval_mode}
            onValueChange={(v) =>
              setSettings((s) => ({
                ...s,
                default_approval_mode: v as "auto" | "manual",
              }))
            }
          >
            <SelectTrigger className="w-[250px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                Auto - Automatically assign proxies
              </SelectItem>
              <SelectItem value="manual">
                Manual - Require admin approval
              </SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Cài đặt thùng rác */}
      <Card>
        <CardHeader>
          <CardTitle>Trash Cài đặt</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="trash-days">
              Auto-clean trash after (days)
            </Label>
            <Input
              id="trash-days"
              type="number"
              min={1}
              max={365}
              value={settings.auto_clean_trash_days}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  auto_clean_trash_days: parseInt(e.target.value) || 30,
                }))
              }
              className="w-[150px]"
            />
          </div>
        </CardContent>
      </Card>

      {/* Apply to Existing Users */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="apply-existing"
              checked={applyToExisting}
              onCheckedChange={(checked) =>
                setApplyToExisting(checked === true)
              }
            />
            <Label htmlFor="apply-existing" className="cursor-pointer">
              Áp dụng giới hạn mặc định cho mọi người dùng đã có when saving
            </Label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            When checked, saving will bulk-update all non-deleted users with the
            current default rate limits, max proxies, and approval mode.
          </p>
        </CardContent>
      </Card>

      <Separator />

      {/* Admin Telegram IDs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-5" />
            Admin Telegram IDs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
            Deprecated: Each admin should set their Telegram ID in their own
            Profile page.
          </p>
          <p className="text-sm text-muted-foreground">
            Comma-separated Telegram user IDs that can approve/reject proxy
            requests via the bot using /requests command.
          </p>
          <div className="space-y-2">
            <Label htmlFor="admin-tg-ids">Telegram IDs</Label>
            <Input
              id="admin-tg-ids"
              value={settings.admin_telegram_ids}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  admin_telegram_ids: e.target.value,
                }))
              }
              placeholder="e.g. 123456789, 987654321"
            />
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Cài đặt Bot Telegram */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Bot Telegram</CardTitle>
            <div className="flex items-center gap-2">
              {botConnected !== null && (
                <Badge
                  variant={botConnected ? "default" : "destructive"}
                  className="gap-1"
                >
                  {botConnected ? (
                    <Wifi className="size-3" />
                  ) : (
                    <WifiOff className="size-3" />
                  )}
                  {botConnected ? "Connected" : "Disconnected"}
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestBot}
                disabled={testingBot}
              >
                {testingBot ? "Testing..." : "Test Connection"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bot-token">Bot Token</Label>
            <div className="flex gap-2">
              <Input
                id="bot-token"
                type="password"
                value={settings.telegram_bot_token}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    telegram_bot_token: e.target.value,
                  }))
                }
                placeholder="Enter bot token from @BotFather"
              />
              <Badge variant="outline" className="shrink-0 self-center">
                {settings.telegram_bot_token
                  ? maskToken(settings.telegram_bot_token)
                  : "Not set"}
              </Badge>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="webhook-secret">Webhook Secret</Label>
            <Input
              id="webhook-secret"
              type="password"
              value={settings.telegram_webhook_secret}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  telegram_webhook_secret: e.target.value,
                }))
              }
              placeholder="Secret token for webhook verification"
            />
          </div>

          <div className="space-y-2">
            <Label>Webhook URL</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={
                  settings.webhook_url ||
                  `${typeof window !== "undefined" ? window.location.origin : ""}/api/telegram/webhook`
                }
                className="bg-muted"
              />
              <Button variant="outline" size="icon" onClick={copyWebhookUrl}>
                <Copy className="size-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Set this URL in your Telegram bot webhook configuration.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Wave 22X — confirm before broadcasting rate-limit changes to
          every existing bot user. The api/settings handler iterates
          tele_users and resets max_proxies; one slip and thousands
          of accounts get a different limit silently. */}
      <ConfirmDialog
        open={showApplyConfirm}
        onOpenChange={setShowApplyConfirm}
        variant="destructive"
        title="Áp dụng cho TẤT CẢ user hiện có?"
        description={
          `Bạn đã đánh dấu "Áp dụng cho user đã có". Khi xác nhận, ` +
          `rate-limit và max_proxies mới sẽ ghi đè cấu hình hiện tại của ` +
          `MỌI bot user (bao gồm các user đã được override thủ công). ` +
          `Hành động này không thể undo. Hãy chắc chắn trước khi tiếp tục.`
        }
        confirmText="Áp dụng cho mọi user"
        cancelText="Huỷ"
        loading={saving}
        onConfirm={handleSave}
      />
    </div>
  );
}
