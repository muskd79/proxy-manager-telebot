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
      toast.error("Failed to load profile");
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
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex-1 space-y-6 p-6">
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">Failed to load profile data.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">
          Manage your account, security, and 2FA settings
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
            {profile.is_active ? "Active" : "Inactive"}
          </Badge>
          {profile.totp_enabled_at && (
            <Badge variant="default" className="bg-emerald-600">
              <ShieldCheck className="size-3 mr-1" />
              2FA enabled
            </Badge>
          )}
          {profile.pending_email && (
            <Badge variant="outline" className="border-orange-500 text-orange-600">
              <Mail className="size-3 mr-1" />
              Pending: {profile.pending_email}
            </Badge>
          )}
          {profile.last_login_at && (
            <span className="text-muted-foreground ml-auto">
              Last login: {new Date(profile.last_login_at).toLocaleString()}
              {profile.last_login_ip && ` · ${profile.last_login_ip}`}
            </span>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="2fa">Two-Factor</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
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
        toast.success("Profile updated");
        onUpdate();
      } else {
        toast.error(body.error || "Failed to update");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="full-name">Full Name</Label>
          <Input
            id="full-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={100}
            placeholder="e.g. John Doe"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="telegram-id">Telegram ID</Label>
          <Input
            id="telegram-id"
            type="number"
            value={telegramId}
            onChange={(e) => setTelegramId(e.target.value)}
            placeholder="e.g. 123456789"
          />
          <p className="text-xs text-muted-foreground">
            Use @userinfobot on Telegram to find your ID. Required to receive
            admin alerts on your phone.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="size-4 mr-1.5" />
          {saving ? "Saving..." : "Save Changes"}
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
      toast.error("New password must be at least 12 characters");
      return;
    }
    if (newPwd !== confirmPwd) {
      toast.error("Passwords don't match");
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
        toast.success(body.message || "Password changed; other sessions signed out");
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
          Change Password
        </CardTitle>
        <CardDescription>
          Server-side change with current-password gate. All other sessions
          are revoked on success.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Current Password</Label>
          <Input
            type="password"
            value={currentPwd}
            onChange={(e) => setCurrentPwd(e.target.value)}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>New Password</Label>
            <Input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="Min 12 chars"
            />
          </div>
          <div className="space-y-2">
            <Label>Confirm New Password</Label>
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
          Change Password
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
        toast.success(body.message || "Confirmation link sent");
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
          Change Email
        </CardTitle>
        <CardDescription>
          Current: <span className="font-mono">{currentEmail}</span>. We send a
          confirmation link to the new address; click it to complete the
          change.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Current Password</Label>
          <Input
            type="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>New Email</Label>
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
          Send Confirmation Link
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
        toast.success("2FA enabled!");
        setBackupCodes(body.data?.backup_codes ?? []);
        setEnrollData(null);
        setCode("");
        onChanged();
      } else {
        toast.error(body.error || "Invalid code");
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
        toast.success("2FA disabled");
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
    const pwd = window.prompt("Enter your current password to regenerate codes:");
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
        toast.success("New backup codes issued");
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
            Two-Factor Authentication
            {enabled && (
              <Badge variant="default" className="bg-emerald-600 ml-2">
                Enabled
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            TOTP-based 2FA via any authenticator app (Google Authenticator,
            Authy, 1Password, etc).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!enabled && !enrollData && (
            <Button onClick={handleStart} disabled={loading}>
              <ShieldCheck className="size-4 mr-1.5" />
              Enable 2FA
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
                  Scan with your authenticator, or enter manually:
                </p>
                <code className="text-xs bg-muted px-2 py-1 rounded">{enrollData.secret}</code>
              </div>
              <div className="space-y-2">
                <Label>Enter 6-digit code from app</Label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  maxLength={6}
                  placeholder="123456"
                />
              </div>
              <Button onClick={handleVerify} disabled={loading || code.length !== 6}>
                <ShieldCheck className="size-4 mr-1.5" />
                Verify & Enable
              </Button>
            </div>
          )}

          {enabled && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleRegenerate} disabled={loading}>
                Regenerate backup codes
              </Button>
              <Button
                variant="destructive"
                onClick={() => setShowDisable(true)}
              >
                <ShieldOff className="size-4 mr-1.5" />
                Disable 2FA
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disable 2FA dialog */}
      <Dialog open={showDisable} onOpenChange={setShowDisable}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable 2FA</DialogTitle>
            <DialogDescription>
              Enter your current password to confirm. Your authenticator app
              will be unenrolled and backup codes deleted.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            placeholder="Current password"
            value={disablePwd}
            onChange={(e) => setDisablePwd(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisable(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisable}
              disabled={loading || !disablePwd}
            >
              Disable 2FA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Backup codes display dialog */}
      <Dialog open={!!backupCodes} onOpenChange={(o) => !o && setBackupCodes(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save your backup codes</DialogTitle>
            <DialogDescription>
              Each code works ONCE. Use one to log in if you lose your
              authenticator device. Store them in a password manager —
              they will not be shown again.
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
                  toast.success("Copied all codes to clipboard");
                }}
              >
                <ClipboardCopy className="size-4 mr-1.5" />
                Copy all
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setBackupCodes(null)}>I&rsquo;ve saved them</Button>
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
    if (!confirm("Revoke ALL other browser sessions? You'll stay signed in here.")) return;
    setRevoking(true);
    try {
      const res = await fetch("/api/profile/sessions/revoke", { method: "POST" });
      if (res.ok) {
        toast.success("Other sessions revoked");
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
          Sessions & Login History
        </CardTitle>
        <CardDescription>
          Last 30 events. Revoke other sessions if you suspect a stolen cookie.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button variant="outline" onClick={handleRevoke} disabled={revoking}>
          {revoking ? (
            <Loader2 className="size-4 mr-1.5 animate-spin" />
          ) : (
            <LogOut className="size-4 mr-1.5" />
          )}
          Sign out all other sessions
        </Button>

        {loading ? (
          <Loader2 className="size-5 animate-spin" />
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <AlertCircle className="size-4" /> No history yet — login_logs table
            may not have any entries before Wave 22F. New events will appear
            here.
          </p>
        ) : (
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs">
                <tr>
                  <th className="text-left p-2">Time</th>
                  <th className="text-left p-2">Action</th>
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
