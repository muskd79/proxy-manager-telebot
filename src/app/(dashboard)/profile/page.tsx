"use client";

import { useEffect, useState, useCallback } from "react";
import {
  RefreshCw,
  Save,
  User,
  Lock,
  Loader2,
  Mail,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  LogOut,
  ClipboardCopy,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

/**
 * Wave 22F-D — /profile page rebuild.
 *
 * Tabs:
 *   - Profile  : full_name, telegram_id, language
 *   - Security : change password (server-side now), change email
 *   - 2FA      : enroll / disable / regenerate backup codes
 *   - Sessions : login history + revoke other sessions
 *
 * Replaces the pre-22F page that did client-side
 * supabase.auth.updateUser({ password }) — no audit, no
 * current-password gate, no session revoke. All sensitive
 * operations now go through Wave 22F-A/B server routes.
 */

interface ProfileData {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  telegram_id?: number | null;
  language?: string;
  last_login_at?: string | null;
  last_login_ip?: string | null;
  login_count?: number;
  totp_enabled_at?: string | null;
  password_changed_at?: string | null;
  pending_email?: string | null;
}

interface LoginLogRow {
  id: string;
  action: string;
  ip_address: string | null;
  user_agent: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/profile");
      if (res.ok) {
        const result = await res.json();
        if (result.data) setProfile(result.data);
      }
    } catch (err) {
      console.error("Failed to fetch profile:", err);
      toast.error("Tải hồ sơ thất bại");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  if (loading) {
    return (
      <div className="flex-1 space-y-6 p-6">
        <h1 className="text-2xl font-bold tracking-tight">Hồ sơ</h1>
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex-1 space-y-6 p-6">
        <h1 className="text-2xl font-bold tracking-tight">Hồ sơ</h1>
        <p className="text-muted-foreground">Tải hồ sơ thất bại.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Hồ sơ</h1>
        <p className="text-muted-foreground">
          Quản lý tài khoản, bảo mật và cài đặt 2FA
        </p>
      </div>

      {/* Account summary card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="size-5" />
            {profile.full_name || profile.email}
          </CardTitle>
          <CardDescription>{profile.email}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="default">{profile.role.replace("_", " ")}</Badge>
          <Badge variant={profile.is_active ? "default" : "destructive"}>
            {profile.is_active ? "Đang hoạt động" : "Không hoạt động"}
          </Badge>
          {profile.totp_enabled_at && (
            <Badge variant="default" className="bg-emerald-600">
              <ShieldCheck className="size-3 mr-1" />
              Đã bật 2FA
            </Badge>
          )}
          {profile.pending_email && (
            <Badge variant="outline" className="border-orange-500 text-orange-600">
              <Mail className="size-3 mr-1" />
              Đang chờ: {profile.pending_email}
            </Badge>
          )}
          {profile.last_login_at && (
            <span className="text-muted-foreground ml-auto">
              Đăng nhập lần cuối: {new Date(profile.last_login_at).toLocaleString()}
              {profile.last_login_ip && ` · ${profile.last_login_ip}`}
            </span>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Cá nhân</TabsTrigger>
          <TabsTrigger value="security">Bảo mật</TabsTrigger>
          <TabsTrigger value="2fa">Xác thực 2 lớp</TabsTrigger>
          <TabsTrigger value="sessions">Phiên đăng nhập</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-4">
          <ProfileTab profile={profile} onUpdate={fetchProfile} />
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <PasswordCard onChanged={fetchProfile} />
          <EmailCard currentEmail={profile.email} onChanged={fetchProfile} />
        </TabsContent>

        <TabsContent value="2fa" className="space-y-4">
          <TwoFactorCard
            enabled={!!profile.totp_enabled_at}
            onChanged={fetchProfile}
          />
        </TabsContent>

        <TabsContent value="sessions" className="space-y-4">
          <SessionsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// PROFILE TAB
// ============================================================
function ProfileTab({ profile, onUpdate }: { profile: ProfileData; onUpdate: () => void }) {
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [telegramId, setTelegramId] = useState(
    profile.telegram_id != null ? String(profile.telegram_id) : "",
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName || null,
          telegram_id: telegramId ? Number(telegramId) : null,
        }),
      });
      const body = await res.json();
      if (res.ok) {
        toast.success("Đã cập nhật hồ sơ");
        onUpdate();
      } else {
        toast.error(body.error || "Cập nhật thất bại");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Thông tin cá nhân</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="full-name">Họ và tên</Label>
          <Input
            id="full-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={100}
            placeholder="VD: Nguyễn Văn A"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="telegram-id">Telegram ID</Label>
          <Input
            id="telegram-id"
            type="number"
            value={telegramId}
            onChange={(e) => setTelegramId(e.target.value)}
            placeholder="VD: 123456789"
          />
          <p className="text-xs text-muted-foreground">
            Dùng @userinfobot trên Telegram để lấy ID. Cần thiết để nhận
            thông báo admin trên điện thoại.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="size-4 mr-1.5" />
          {saving ? "Đang lưu..." : "Lưu thay đổi"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ============================================================
// PASSWORD CARD (server-side via /api/profile/password)
// ============================================================
function PasswordCard({ onChanged }: { onChanged: () => void }) {
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = async () => {
    if (newPwd.length < 12) {
      toast.error("Mật khẩu mới tối thiểu 12 ký tự");
      return;
    }
    if (newPwd !== confirmPwd) {
      toast.error("Mật khẩu không khớp");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: currentPwd,
          new_password: newPwd,
        }),
      });
      const body = await res.json();
      if (res.ok) {
        toast.success(body.message || "Đã đổi mật khẩu; các phiên khác đã đăng xuất");
        setCurrentPwd("");
        setNewPwd("");
        setConfirmPwd("");
        onChanged();
      } else {
        toast.error(body.error || "Failed");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="size-5" />
          Đổi mật khẩu
        </CardTitle>
        <CardDescription>
          Đổi mật khẩu phía server với xác thực mật khẩu hiện tại. Tất cả phiên khác sẽ bị thu hồi khi thành công.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Mật khẩu hiện tại</Label>
          <Input
            type="password"
            value={currentPwd}
            onChange={(e) => setCurrentPwd(e.target.value)}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Mật khẩu mới</Label>
            <Input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="Tối thiểu 12 ký tự"
            />
          </div>
          <div className="space-y-2">
            <Label>Xác nhận mật khẩu mới</Label>
            <Input
              type="password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
            />
          </div>
        </div>
        <Button onClick={handleChange} disabled={loading || !currentPwd || !newPwd}>
          {loading ? (
            <Loader2 className="size-4 mr-1.5 animate-spin" />
          ) : (
            <Lock className="size-4 mr-1.5" />
          )}
          Đổi mật khẩu
        </Button>
      </CardContent>
    </Card>
  );
}

// ============================================================
// EMAIL CARD (initiate change via /api/profile/email)
// ============================================================
function EmailCard({ currentEmail, onChanged }: { currentEmail: string; onChanged: () => void }) {
  const [pwd, setPwd] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/profile/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: pwd,
          new_email: newEmail,
        }),
      });
      const body = await res.json();
      if (res.ok) {
        toast.success(body.message || "Đã gửi link xác nhận");
        setPwd("");
        setNewEmail("");
        onChanged();
      } else {
        toast.error(body.error || "Failed");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="size-5" />
          Đổi email
        </CardTitle>
        <CardDescription>
          Hiện tại: <span className="font-mono">{currentEmail}</span>. Chúng tôi sẽ gửi link xác nhận đến địa chỉ mới; nhấn vào để hoàn tất thay đổi.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Mật khẩu hiện tại</Label>
          <Input
            type="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Email mới</Label>
          <Input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
        </div>
        <Button onClick={handleChange} disabled={loading || !pwd || !newEmail}>
          {loading ? (
            <Loader2 className="size-4 mr-1.5 animate-spin" />
          ) : (
            <Mail className="size-4 mr-1.5" />
          )}
          Gửi link xác nhận
        </Button>
      </CardContent>
    </Card>
  );
}

// ============================================================
// 2FA CARD (enroll / verify / disable / regenerate)
// ============================================================
function TwoFactorCard({ enabled, onChanged }: { enabled: boolean; onChanged: () => void }) {
  const [enrollData, setEnrollData] = useState<{
    factor_id: string;
    qr_code: string;
    secret: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disablePwd, setDisablePwd] = useState("");
  const [showDisable, setShowDisable] = useState(false);

  const handleStart = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/profile/2fa/enroll", { method: "POST" });
      const body = await res.json();
      if (res.ok) setEnrollData(body.data);
      else toast.error(body.error || "Failed to start");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!enrollData) return;
    setLoading(true);
    try {
      const res = await fetch("/api/profile/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factor_id: enrollData.factor_id, code }),
      });
      const body = await res.json();
      if (res.ok) {
        toast.success("Đã bật 2FA!");
        setBackupCodes(body.data?.backup_codes ?? []);
        setEnrollData(null);
        setCode("");
        onChanged();
      } else {
        toast.error(body.error || "Mã không hợp lệ");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/profile/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: disablePwd }),
      });
      const body = await res.json();
      if (res.ok) {
        toast.success("Đã tắt 2FA");
        setShowDisable(false);
        setDisablePwd("");
        onChanged();
      } else {
        toast.error(body.error || "Failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async () => {
    const pwd = window.prompt("Nhập mật khẩu hiện tại để tạo lại mã backup:");
    if (!pwd) return;
    setLoading(true);
    try {
      const res = await fetch("/api/profile/2fa/backup-codes/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: pwd }),
      });
      const body = await res.json();
      if (res.ok) {
        setBackupCodes(body.data?.backup_codes ?? []);
        toast.success("Đã cấp mã backup mới");
      } else {
        toast.error(body.error || "Failed");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="size-5" />
            Xác thực hai lớp (2FA)
            {enabled && (
              <Badge variant="default" className="bg-emerald-600 ml-2">
                Đã bật
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Xác thực TOTP qua ứng dụng authenticator (Google Authenticator,
            Authy, 1Password, v.v.).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!enabled && !enrollData && (
            <Button onClick={handleStart} disabled={loading}>
              <ShieldCheck className="size-4 mr-1.5" />
              Bật 2FA
            </Button>
          )}

          {enrollData && (
            <div className="space-y-3 rounded-md border p-4">
              <div className="flex flex-col items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={enrollData.qr_code}
                  alt="2FA QR"
                  className="size-40 border"
                />
                <p className="text-xs text-muted-foreground">
                  Quét bằng ứng dụng authenticator, hoặc nhập thủ công:
                </p>
                <code className="text-xs bg-muted px-2 py-1 rounded">{enrollData.secret}</code>
              </div>
              <div className="space-y-2">
                <Label>Nhập mã 6 chữ số từ ứng dụng</Label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  maxLength={6}
                  placeholder="123456"
                />
              </div>
              <Button onClick={handleVerify} disabled={loading || code.length !== 6}>
                <ShieldCheck className="size-4 mr-1.5" />
                Xác nhận & Bật
              </Button>
            </div>
          )}

          {enabled && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleRegenerate} disabled={loading}>
                Tạo lại mã backup
              </Button>
              <Button
                variant="destructive"
                onClick={() => setShowDisable(true)}
              >
                <ShieldOff className="size-4 mr-1.5" />
                Tắt 2FA
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disable 2FA dialog */}
      <Dialog open={showDisable} onOpenChange={setShowDisable}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tắt 2FA</DialogTitle>
            <DialogDescription>
              Nhập mật khẩu hiện tại để xác nhận. Ứng dụng authenticator sẽ bị huỷ đăng ký và mã backup sẽ bị xoá.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            placeholder="Mật khẩu hiện tại"
            value={disablePwd}
            onChange={(e) => setDisablePwd(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisable(false)}>
              Huỷ
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisable}
              disabled={loading || !disablePwd}
            >
              Tắt 2FA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Backup codes display dialog */}
      <Dialog open={!!backupCodes} onOpenChange={(o) => !o && setBackupCodes(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lưu mã backup của bạn</DialogTitle>
            <DialogDescription>
              Mỗi mã chỉ dùng được MỘT LẦN. Dùng để đăng nhập nếu mất thiết bị authenticator. Lưu vào trình quản lý mật khẩu —
              chúng sẽ không được hiển thị lại.
            </DialogDescription>
          </DialogHeader>
          {backupCodes && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                {backupCodes.map((c) => (
                  <code key={c} className="bg-muted px-2 py-1 rounded">{c}</code>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(backupCodes.join("\n"));
                  toast.success("Đã chép toàn bộ mã");
                }}
              >
                <ClipboardCopy className="size-4 mr-1.5" />
                Sao chép tất cả
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setBackupCodes(null)}>Đã lưu xong</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============================================================
// SESSIONS TAB (login history + revoke others)
// ============================================================
function SessionsTab() {
  const [history, setHistory] = useState<LoginLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/profile/login-history?limit=30");
      if (res.ok) {
        const body = await res.json();
        setHistory(body.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleRevoke = async () => {
    if (!confirm("Thu hồi TẤT CẢ các phiên trình duyệt khác? Bạn vẫn sẽ ở lại trang này.")) return;
    setRevoking(true);
    try {
      const res = await fetch("/api/profile/sessions/revoke", { method: "POST" });
      if (res.ok) {
        toast.success("Đã thu hồi các phiên khác");
        fetchHistory();
      } else {
        const body = await res.json();
        toast.error(body.error || "Failed");
      }
    } finally {
      setRevoking(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LogOut className="size-5" />
          Phiên đăng nhập & Lịch sử
        </CardTitle>
        <CardDescription>
          30 sự kiện gần nhất. Thu hồi các phiên khác nếu bạn nghi ngờ cookie bị đánh cắp.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button variant="outline" onClick={handleRevoke} disabled={revoking}>
          {revoking ? (
            <Loader2 className="size-4 mr-1.5 animate-spin" />
          ) : (
            <LogOut className="size-4 mr-1.5" />
          )}
          Đăng xuất tất cả phiên khác
        </Button>

        {loading ? (
          <Loader2 className="size-5 animate-spin" />
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <AlertCircle className="size-4" /> Chưa có lịch sử — bảng login_logs
            có thể chưa có bản ghi trước Wave 22F. Sự kiện mới sẽ hiển thị
            ở đây.
          </p>
        ) : (
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs">
                <tr>
                  <th className="text-left p-2">Thời gian</th>
                  <th className="text-left p-2">Thao tác</th>
                  <th className="text-left p-2">IP</th>
                  <th className="text-left p-2">User-Agent</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t">
                    <td className="p-2 whitespace-nowrap">
                      {new Date(h.created_at).toLocaleString()}
                    </td>
                    <td className="p-2">
                      <Badge variant={h.action.includes("failed") ? "destructive" : "outline"}>
                        {h.action}
                      </Badge>
                    </td>
                    <td className="p-2 font-mono text-xs">{h.ip_address ?? "-"}</td>
                    <td className="p-2 text-xs text-muted-foreground max-w-xs truncate">
                      {h.user_agent ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
