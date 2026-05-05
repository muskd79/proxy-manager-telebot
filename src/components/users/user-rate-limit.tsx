"use client";

import { useState, useEffect } from "react";
import { Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
// Wave 28-G [HIGH] — typed-confirm before saving rate_limit=0 which
// would silently block the user from any new proxy. Mirrors the
// Wave 28 mass-hide gate on /categories.
import { DangerousConfirmDialog } from "@/components/shared/dangerous-confirm-dialog";
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
  const [errors, setErrors] = useState<string[]>([]);
  // Wave 28-G — typed-confirm gate when admin sets a limit to 0.
  // Pre-fix: zero passed Zod min(0) and got persisted; the bot
  // then evaluated `proxies_used >= 0` → blocked the user with no
  // affordance to distinguish "intentional" from "misconfigured".
  const [zeroConfirmOpen, setZeroConfirmOpen] = useState(false);

  // Validate limit hierarchy on every change
  useEffect(() => {
    const newErrors: string[] = [];
    if (hourlyLimit > dailyLimit) {
      newErrors.push("Hourly limit cannot exceed daily limit");
    }
    if (dailyLimit > totalLimit) {
      newErrors.push("Daily limit cannot exceed total limit");
    }
    if (hourlyLimit === 0 || dailyLimit === 0 || totalLimit === 0) {
      newErrors.push("Warning: Setting limit to 0 will block all proxy requests for this user");
    }
    setErrors(newErrors);
  }, [hourlyLimit, dailyLimit, totalLimit]);

  useEffect(() => {
    setHourlyLimit(user.rate_limit_hourly);
    setDailyLimit(user.rate_limit_daily);
    setTotalLimit(user.rate_limit_total);
    setMaxProxies(user.max_proxies);
    setApprovalMode(user.approval_mode);
  }, [user]);

  const hasZero =
    hourlyLimit === 0 ||
    dailyLimit === 0 ||
    totalLimit === 0 ||
    maxProxies === 0;

  const requestSave = () => {
    if (hasZero && !zeroConfirmOpen) {
      setZeroConfirmOpen(true);
      return;
    }
    void handleSave();
  };

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
        toast.success("Đã cập nhật rate limits");
      } else {
        toast.error("Cập nhật rate limits thất bại");
      }
    } catch (err) {
      console.error("Failed to save rate limits:", err);
      toast.error("Có lỗi xảy ra khi lưu");
    } finally {
      setIsSaving(false);
      setZeroConfirmOpen(false);
    }
  };

  const getUsagePercentage = (used: number, limit: number) => {
    if (limit === 0) return 100; // 0 means blocked = 100% used
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
                Max requests per hour (0 = blocked)
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
                Max requests per day (0 = blocked)
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
                Max total requests, lifetime (0 = blocked)
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

          {errors.length > 0 && (
            <div className="rounded-md border border-yellow-500 bg-yellow-500/10 p-3 space-y-1">
              {errors.map((err, i) => (
                <p key={i} className="text-sm text-yellow-600 dark:text-yellow-400">{err}</p>
              ))}
            </div>
          )}

          <Button
            onClick={requestSave}
            disabled={isSaving || hourlyLimit > dailyLimit || dailyLimit > totalLimit}
            className="w-full sm:w-auto"
          >
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Lưu thay đổi
          </Button>
        </CardContent>
      </Card>

      {/* Wave 28-G [HIGH] — typed-confirm gate when any limit = 0. */}
      <DangerousConfirmDialog
        open={zeroConfirmOpen}
        onOpenChange={setZeroConfirmOpen}
        title="Đặt giới hạn về 0?"
        description={
          <div className="space-y-2 text-sm">
            <p>
              Một hoặc nhiều rate limit đang được đặt về <strong>0</strong>.
              Hậu quả: user này sẽ bị bot từ chối MỌI yêu cầu mới (không
              giao proxy được).
            </p>
            <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
              {hourlyLimit === 0 && <li>Rate limit / giờ = 0</li>}
              {dailyLimit === 0 && <li>Rate limit / ngày = 0</li>}
              {totalLimit === 0 && <li>Rate limit / tổng = 0</li>}
              {maxProxies === 0 && <li>Số proxy tối đa = 0</li>}
            </ul>
            <p className="text-xs text-muted-foreground">
              Có chắc bạn muốn chặn user này khỏi tính năng đó? Gõ
              <code className="mx-1 rounded bg-muted px-1 font-mono">CHAN USER</code>
              để xác nhận.
            </p>
          </div>
        }
        confirmString="CHAN USER"
        actionLabel="Lưu (chặn user)"
        loading={isSaving}
        onConfirm={async () => {
          await handleSave();
        }}
      />
    </div>
  );
}
