"use client";

import { useEffect, useState, useCallback } from "react";
import { Save, RefreshCw, Wifi, WifiOff, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsForm>({
    default_rate_limit_hourly: 3,
    default_rate_limit_daily: 10,
    default_rate_limit_total: 50,
    default_approval_mode: "auto",
    auto_clean_trash_days: 30,
    telegram_bot_token: "",
    telegram_webhook_secret: "",
    webhook_url: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
          }));
        }
      }
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_settings", settings }),
      });
      if (res.ok) {
        toast.success("Settings saved successfully");
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to save settings");
      }
    } catch {
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
        toast.error("Bot connection test failed");
      }
    } catch {
      setBotConnected(false);
      toast.error("Bot connection test failed");
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
      toast.success("Webhook URL copied");
    }
  };

  if (loading) {
    return (
      <div className="flex-1 space-y-6 p-6">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
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
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            System configuration and preferences
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="size-4 mr-1.5" />
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>

      {/* Default Rate Limits */}
      <Card>
        <CardHeader>
          <CardTitle>Default Rate Limits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Default rate limits applied to new Telegram users.
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="hourly">Hourly Limit</Label>
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
              <Label htmlFor="daily">Daily Limit</Label>
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
              <Label htmlFor="total">Total Limit</Label>
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

      {/* Approval Mode */}
      <Card>
        <CardHeader>
          <CardTitle>Default Approval Mode</CardTitle>
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

      {/* Trash Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Trash Settings</CardTitle>
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

      <Separator />

      {/* Telegram Bot Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Telegram Bot</CardTitle>
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
    </div>
  );
}
