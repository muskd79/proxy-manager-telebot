"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ShieldOff, AlertTriangle, ArrowLeft, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Wave 22L (Phase 1 — C2) — /auth/recover-2fa
 *
 * Self-service 2FA recovery khi user mất authenticator + backup codes.
 * Yêu cầu 3 yếu tố: email + mật khẩu + 1 mã backup. Trên success,
 * 2FA bị vô hiệu hoá, user đăng nhập lại bình thường rồi tự bật lại
 * 2FA + lưu mã backup mới.
 */

export default function Recover2FAPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/recover-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          current_password: password,
          backup_code: backupCode,
        }),
      });
      const body = await res.json();
      if (res.ok) {
        setDone(true);
        toast.success(body.message || "Đã gỡ 2FA");
      } else {
        toast.error(body.error || "Không khớp thông tin");
      }
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <CheckCircle2 className="size-12 mx-auto text-emerald-500 mb-2" />
            <CardTitle>2FA đã được gỡ bỏ</CardTitle>
            <CardDescription>
              Bây giờ đăng nhập lại bằng email + mật khẩu, không cần mã 6 số.
              Sau đó vào /profile để bật lại 2FA và lưu mã backup mới.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/login">
              <Button className="w-full">Đăng nhập lại</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <div className="flex items-center gap-2 mb-2">
            <ShieldOff className="size-6 text-orange-500" />
            <CardTitle>Khôi phục 2FA</CardTitle>
          </div>
          <CardDescription>
            Dùng khi mất thiết bị authenticator. Cần đủ 3 thông tin: email +
            mật khẩu + 1 mã backup chưa sử dụng.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 rounded-md border border-orange-500/30 bg-orange-500/5 p-3 text-sm">
            <div className="flex gap-2">
              <AlertTriangle className="size-4 text-orange-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-orange-700 dark:text-orange-400">
                  Mã backup là 1 lần dùng
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Sau khi recovery, mã đã dùng sẽ bị vô hiệu. 2FA bị tắt
                  hoàn toàn — đăng nhập lại rồi vào /profile bật lại sớm
                  để bảo mật.
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Mật khẩu hiện tại</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="backup-code">Mã backup</Label>
              <Input
                id="backup-code"
                value={backupCode}
                onChange={(e) => setBackupCode(e.target.value)}
                placeholder="XXXX-XXXX-XXXX"
                maxLength={20}
                className="font-mono"
                required
              />
              <p className="text-xs text-muted-foreground">
                Định dạng 12 ký tự (3 nhóm 4) — không phân biệt hoa thường,
                bỏ qua dấu gạch.
              </p>
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Đang xác minh..." : "Gỡ 2FA & đăng nhập lại"}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <Link
              href="/login"
              className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1"
            >
              <ArrowLeft className="size-3" />
              Quay lại đăng nhập
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
