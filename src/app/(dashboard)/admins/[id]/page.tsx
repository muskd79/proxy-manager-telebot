"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  RefreshCw,
  Save,
  Lock,
  ShieldOff,
  LogOut,
  Trash2,
  ClipboardCopy,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DangerousConfirmDialog } from "@/components/shared/dangerous-confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import Link from "next/link";

/**
 * Wave 22F-D — /admins/[id] super_admin detail page.
 *
 * Tabs: Profile (edit) + Security (force actions).
 *
 * Force actions wired to Wave 22F-C endpoints:
 *   - Reset password (generated or custom)
 *   - Disable 2FA (no password gate — only super_admin reaches here)
 *   - Revoke all sessions
 *   - Hard delete (with self + last-super-admin guards)
 *
 * Self-target: PUT works, force actions show clear errors (matches
 * the API guards from Wave 22F-C).
 */

interface AdminDetail {
  id: string;
  email: string;
  full_name: string | null;
  role: "super_admin" | "admin" | "viewer";
  is_active: boolean;
  language?: string;
  telegram_id?: number | null;
  last_login_at?: string | null;
  last_login_ip?: string | null;
  login_count?: number;
  totp_enabled_at?: string | null;
  password_changed_at?: string | null;
  pending_email?: string | null;
  locked_until?: string | null;
  lockout_reason?: string | null;
  created_at: string;
}

export default function AdminDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [admin, setAdmin] = useState<AdminDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState("");
  const [telegramId, setTelegramId] = useState("");
  const [language, setLanguage] = useState("vi");
  const [saving, setSaving] = useState(false);

  // Action dialogs
  const [showResetPwd, setShowResetPwd] = useState(false);
  const [resetPwdMode, setResetPwdMode] = useState<"generate" | "custom">("generate");
  const [customPwd, setCustomPwd] = useState("");
  const [generatedPwd, setGeneratedPwd] = useState<string | null>(null);

  const [showDisable2FA, setShowDisable2FA] = useState(false);
  const [showRevoke, setShowRevoke] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [acting, setActing] = useState(false);

  const fetchAdmin = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admins/${id}`);
      if (res.ok) {
        const body = await res.json();
        const a: AdminDetail = body.data;
        setAdmin(a);
        setFullName(a.full_name ?? "");
        setTelegramId(a.telegram_id != null ? String(a.telegram_id) : "");
        setLanguage(a.language ?? "vi");
      } else if (res.status === 403) {
        toast.error("Only super_admin can view this page");
        router.replace("/admins");
      } else {
        toast.error("Failed to load admin");
      }
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    fetchAdmin();
  }, [fetchAdmin]);

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admins/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName || null,
          telegram_id: telegramId ? Number(telegramId) : null,
          language,
        }),
      });
      const body = await res.json();
      if (res.ok) {
        toast.success("Profile updated");
        fetchAdmin();
      } else {
        toast.error(body.error || "Failed");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async () => {
    setActing(true);
    try {
      const payload =
        resetPwdMode === "generate"
          ? { generate: true }
          : { new_password: customPwd };
      const res = await fetch(`/api/admins/${id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (res.ok) {
        if (body.new_password) setGeneratedPwd(body.new_password);
        else toast.success(body.message || "Password reset");
        setShowResetPwd(false);
        setCustomPwd("");
        fetchAdmin();
      } else {
        toast.error(body.error || "Failed");
      }
    } finally {
      setActing(false);
    }
  };

  const handleDisable2FA = async () => {
    setActing(true);
    try {
      const res = await fetch(`/api/admins/${id}/disable-2fa`, { method: "POST" });
      const body = await res.json();
      if (res.ok) {
        toast.success(body.message || "2FA disabled");
        setShowDisable2FA(false);
        fetchAdmin();
      } else {
        toast.error(body.error || "Failed");
      }
    } finally {
      setActing(false);
    }
  };

  const handleRevokeSessions = async () => {
    setActing(true);
    try {
      const res = await fetch(`/api/admins/${id}/revoke-sessions`, { method: "POST" });
      const body = await res.json();
      if (res.ok) {
        toast.success(body.message || "Sessions revoked");
        setShowRevoke(false);
      } else {
        toast.error(body.error || "Failed");
      }
    } finally {
      setActing(false);
    }
  };

  const handleDelete = async () => {
    setActing(true);
    try {
      const res = await fetch(`/api/admins/${id}`, { method: "DELETE" });
      const body = await res.json();
      if (res.ok) {
        toast.success(body.message || "Admin deleted");
        router.push("/admins");
      } else {
        toast.error(body.error || "Failed");
      }
    } finally {
      setActing(false);
    }
  };

  if (loading || !admin) {
    return (
      <div className="flex-1 p-6">
        <RefreshCw className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link href="/admins">
          <Button variant="outline" size="icon-sm">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {admin.full_name || admin.email}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge>{admin.role.replace("_", " ")}</Badge>
            <Badge variant={admin.is_active ? "default" : "destructive"}>
              {admin.is_active ? "Active" : "Inactive"}
            </Badge>
            {admin.totp_enabled_at && (
              <Badge variant="default" className="bg-emerald-600">
                <Shield className="size-3 mr-1" />
                2FA on
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">{admin.email}</span>
          </div>
        </div>
      </div>

      {/* Profile edit */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Edit basic info. Email + role + active toggle are managed elsewhere
            (settings → Admins).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label>Telegram ID</Label>
              <Input
                type="number"
                value={telegramId}
                onChange={(e) => setTelegramId(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Language</Label>
              <select
                className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option value="vi">Tiếng Việt</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
          <Button onClick={handleSaveProfile} disabled={saving}>
            <Save className="size-4 mr-1.5" />
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      {/* Security force actions */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Security — Force Actions</CardTitle>
          <CardDescription>
            Use sparingly. All actions are audited; the target admin will see
            them in their /profile activity feed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3 p-3 border rounded-md">
            <div>
              <p className="font-medium">Reset password</p>
              <p className="text-xs text-muted-foreground">
                Generate or set a new password. All target&apos;s sessions are
                revoked.
              </p>
            </div>
            <Button variant="outline" onClick={() => setShowResetPwd(true)}>
              <Lock className="size-4 mr-1.5" />
              Reset
            </Button>
          </div>

          {admin.totp_enabled_at && (
            <div className="flex items-center justify-between gap-3 p-3 border rounded-md">
              <div>
                <p className="font-medium">Force-disable 2FA</p>
                <p className="text-xs text-muted-foreground">
                  For incident response when target lost their phone + backup
                  codes.
                </p>
              </div>
              <Button variant="outline" onClick={() => setShowDisable2FA(true)}>
                <ShieldOff className="size-4 mr-1.5" />
                Disable
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 p-3 border rounded-md">
            <div>
              <p className="font-medium">Revoke all sessions</p>
              <p className="text-xs text-muted-foreground">
                Force-logout without deactivating the account. Lighter than
                toggle is_active=false.
              </p>
            </div>
            <Button variant="outline" onClick={() => setShowRevoke(true)}>
              <LogOut className="size-4 mr-1.5" />
              Revoke
            </Button>
          </div>

          <div className="flex items-center justify-between gap-3 p-3 border-2 border-destructive rounded-md bg-destructive/5">
            <div>
              <p className="font-medium text-destructive">Hard delete</p>
              <p className="text-xs text-muted-foreground">
                Permanently removes admin row + auth user. Cannot be undone.
                Self-delete + last-super-admin are blocked.
              </p>
            </div>
            <Button variant="destructive" onClick={() => setShowDelete(true)}>
              <Trash2 className="size-4 mr-1.5" />
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Reset password dialog */}
      <Dialog open={showResetPwd} onOpenChange={setShowResetPwd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password for {admin.email}</DialogTitle>
            <DialogDescription>
              All of their sessions will be force-revoked.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button
                variant={resetPwdMode === "generate" ? "default" : "outline"}
                size="sm"
                onClick={() => setResetPwdMode("generate")}
              >
                Generate random
              </Button>
              <Button
                variant={resetPwdMode === "custom" ? "default" : "outline"}
                size="sm"
                onClick={() => setResetPwdMode("custom")}
              >
                Set specific
              </Button>
            </div>
            {resetPwdMode === "custom" && (
              <Input
                type="password"
                placeholder="Min 12 chars"
                value={customPwd}
                onChange={(e) => setCustomPwd(e.target.value)}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetPwd(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleResetPassword}
              disabled={
                acting || (resetPwdMode === "custom" && customPwd.length < 12)
              }
            >
              Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generated password display */}
      <Dialog open={!!generatedPwd} onOpenChange={(o) => !o && setGeneratedPwd(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New password generated</DialogTitle>
            <DialogDescription>
              Communicate this OOB (signal/in-person). Shown ONCE.
            </DialogDescription>
          </DialogHeader>
          {generatedPwd && (
            <div className="space-y-2">
              <code className="block bg-muted p-3 rounded font-mono text-base text-center">
                {generatedPwd}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(generatedPwd);
                  toast.success("Copied to clipboard");
                }}
              >
                <ClipboardCopy className="size-4 mr-1.5" />
                Copy
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setGeneratedPwd(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable 2FA confirm */}
      <AlertDialog open={showDisable2FA} onOpenChange={setShowDisable2FA}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force-disable 2FA?</AlertDialogTitle>
            <AlertDialogDescription>
              This unenrolls the target admin&apos;s authenticator and deletes
              their backup codes. They&apos;ll log in with email+password only,
              then can re-enroll. Sessions are revoked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisable2FA} disabled={acting}>
              Disable 2FA
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke sessions confirm */}
      <AlertDialog open={showRevoke} onOpenChange={setShowRevoke}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke all sessions?</AlertDialogTitle>
            <AlertDialogDescription>
              {admin.email} will be signed out from every browser. Their
              account stays active — they can sign back in immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevokeSessions} disabled={acting}>
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Wave 22O — type-to-confirm hard delete (UI/UX agent flagged
          single-click destructive admin delete as "không đủ scary"). */}
      <DangerousConfirmDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        title={`Xoá vĩnh viễn ${admin.email}?`}
        description={
          <>
            Xoá hàng admin, auth.users entry, backup codes, và nullify
            actor_id trong audit log. <strong>Không thể hoàn tác.</strong>
            <br />
            <br />
            Bị chặn nếu đây là super_admin cuối cùng còn hoạt động.
          </>
        }
        confirmString={admin.email}
        confirmHint={`Gõ chính xác email "${admin.email}" để xác nhận`}
        actionLabel="Xoá vĩnh viễn"
        loading={acting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
