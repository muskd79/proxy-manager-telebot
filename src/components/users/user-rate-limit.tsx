"use client";

import { useState, useEffect } from "react";
import { Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import type { TeleUser } from "@/types/database";
import { ApprovalMode } from "@/types/database";

interface UserRateLimitProps {
  user: TeleUser;
  onSave: (data: {
    rate_limit_hourly: number;
    rate_limit_daily: number;
    rate_limit_total: number;
    max_proxies: number;
    approval_mode: string;
  }) => Promise<boolean>;
}

export function UserRateLimit({ user, onSave }: UserRateLimitProps) {
  const [hourlyLimit, setHourlyLimit] = useState(user.rate_limit_hourly);
  const [dailyLimit, setDailyLimit] = useState(user.rate_limit_daily);
  const [totalLimit, setTotalLimit] = useState(user.rate_limit_total);
  const [maxProxies, setMaxProxies] = useState(user.max_proxies);
  const [approvalMode, setApprovalMode] = useState<string>(user.approval_mode);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setHourlyLimit(user.rate_limit_hourly);
    setDailyLimit(user.rate_limit_daily);
    setTotalLimit(user.rate_limit_total);
    setMaxProxies(user.max_proxies);
    setApprovalMode(user.approval_mode);
  }, [user]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const success = await onSave({
        rate_limit_hourly: hourlyLimit,
        rate_limit_daily: dailyLimit,
        rate_limit_total: totalLimit,
        max_proxies: maxProxies,
        approval_mode: approvalMode,
      });
      if (success) {
        toast.success("Rate limits updated successfully");
      } else {
        toast.error("Failed to update rate limits");
      }
    } catch {
      toast.error("An error occurred while saving");
    } finally {
      setIsSaving(false);
    }
  };

  const getUsagePercentage = (used: number, limit: number) => {
    if (limit === 0) return 0;
    return Math.min(Math.round((used / limit) * 100), 100);
  };

  const getProgressColor = (percentage: number) => {
    if (percentage >= 90) return "bg-destructive";
    if (percentage >= 70) return "bg-yellow-500";
    return "bg-primary";
  };

  const hourlyPct = getUsagePercentage(user.proxies_used_hourly, hourlyLimit);
  const dailyPct = getUsagePercentage(user.proxies_used_daily, dailyLimit);
  const totalPct = getUsagePercentage(user.proxies_used_total, totalLimit);

  return (
    <div className="space-y-6">
      {/* Current Usage */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg">Current Usage</CardTitle>
          <CardDescription>Real-time usage counters for this user</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Hourly Usage</span>
              <span className="font-mono">
                {user.proxies_used_hourly} / {hourlyLimit}
              </span>
            </div>
            <div className="relative">
              <Progress value={hourlyPct} className="h-2" />
              <div
                className={`absolute inset-0 h-2 rounded-full ${getProgressColor(hourlyPct)} transition-all`}
                style={{ width: `${hourlyPct}%` }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Daily Usage</span>
              <span className="font-mono">
                {user.proxies_used_daily} / {dailyLimit}
              </span>
            </div>
            <div className="relative">
              <Progress value={dailyPct} className="h-2" />
              <div
                className={`absolute inset-0 h-2 rounded-full ${getProgressColor(dailyPct)} transition-all`}
                style={{ width: `${dailyPct}%` }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total Usage</span>
              <span className="font-mono">
                {user.proxies_used_total} / {totalLimit}
              </span>
            </div>
            <div className="relative">
              <Progress value={totalPct} className="h-2" />
              <div
                className={`absolute inset-0 h-2 rounded-full ${getProgressColor(totalPct)} transition-all`}
                style={{ width: `${totalPct}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Rate Limit Configuration */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg">Rate Limit Configuration</CardTitle>
          <CardDescription>
            Set the maximum number of proxy requests this user can make
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="hourly-limit">Hourly Limit</Label>
              <Input
                id="hourly-limit"
                type="number"
                min={0}
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(Number(e.target.value))}
                className="bg-background"
              />
              <p className="text-xs text-muted-foreground">
                Max requests per hour
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="daily-limit">Daily Limit</Label>
              <Input
                id="daily-limit"
                type="number"
                min={0}
                value={dailyLimit}
                onChange={(e) => setDailyLimit(Number(e.target.value))}
                className="bg-background"
              />
              <p className="text-xs text-muted-foreground">
                Max requests per day
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="total-limit">Total Limit</Label>
              <Input
                id="total-limit"
                type="number"
                min={0}
                value={totalLimit}
                onChange={(e) => setTotalLimit(Number(e.target.value))}
                className="bg-background"
              />
              <p className="text-xs text-muted-foreground">
                Max total requests (lifetime)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-proxies">Max Proxies</Label>
              <Input
                id="max-proxies"
                type="number"
                min={0}
                value={maxProxies}
                onChange={(e) => setMaxProxies(Number(e.target.value))}
                className="bg-background"
              />
              <p className="text-xs text-muted-foreground">
                Max concurrent proxies
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div className="space-y-0.5">
              <Label className="text-base">Approval Mode</Label>
              <p className="text-sm text-muted-foreground">
                {approvalMode === ApprovalMode.Auto
                  ? "Requests are automatically approved"
                  : "Requests require manual admin approval"}
              </p>
            </div>
            <Switch
              checked={approvalMode === ApprovalMode.Auto}
              onCheckedChange={(checked) =>
                setApprovalMode(checked ? ApprovalMode.Auto : ApprovalMode.Manual)
              }
            />
          </div>

          <Button onClick={handleSave} disabled={isSaving} className="w-full sm:w-auto">
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Changes
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
