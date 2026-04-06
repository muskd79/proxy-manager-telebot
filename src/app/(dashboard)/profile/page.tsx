"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Save, User, Lock, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface ProfileData {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  telegram_id?: number | null;
  last_login_at?: string | null;
  last_login_ip?: string | null;
  login_count?: number;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [telegramId, setTelegramId] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/profile");
      if (res.ok) {
        const result = await res.json();
        if (result.data) {
          setProfile(result.data);
          setFullName(result.data.full_name ?? "");
          setTelegramId(
            result.data.telegram_id != null
              ? String(result.data.telegram_id)
              : ""
          );
        }
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

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        full_name: fullName || null,
        telegram_id: telegramId ? Number(telegramId) : null,
      };

      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const result = await res.json();
        setProfile(result.data);
        toast.success("Profile updated successfully");
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to update profile");
      }
    } catch (err) {
      console.error("Failed to update profile:", err);
      toast.error("Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordError("");

    if (newPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }

    setIsChangingPassword(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success("Password changed successfully");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      toast.error("Failed to change password");
    } finally {
      setIsChangingPassword(false);
    }
  };

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
          <p className="text-muted-foreground">
            Manage your account information
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="size-4 mr-1.5" />
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {/* Account Info (read-only) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="size-5" />
            Account Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={profile.email} readOnly className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <div className="flex items-center gap-2 pt-1">
                <Badge variant="default">
                  {profile.role.replace("_", " ")}
                </Badge>
                <Badge variant={profile.is_active ? "default" : "destructive"}>
                  {profile.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
            </div>
          </div>
          {profile.last_login_at && (
            <p className="text-sm text-muted-foreground">
              Last login: {new Date(profile.last_login_at).toLocaleString()}
              {profile.last_login_ip && ` from ${profile.last_login_ip}`}
              {profile.login_count != null && profile.login_count > 0 && ` (${profile.login_count} total logins)`}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Editable Fields */}
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
              placeholder="Enter your full name"
              maxLength={100}
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
              min={1}
            />
            <p className="text-xs text-muted-foreground">
              Enter your Telegram user ID to receive bot notifications. Use
              @userinfobot on Telegram to find your ID.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="size-5" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password">New Password</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setPasswordError("");
              }}
              placeholder="Min 8 characters"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm New Password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setPasswordError("");
              }}
              placeholder="Confirm your new password"
            />
          </div>
          {passwordError && (
            <p className="text-sm text-destructive">{passwordError}</p>
          )}
          <Button
            onClick={handleChangePassword}
            disabled={isChangingPassword}
          >
            {isChangingPassword ? (
              <Loader2 className="size-4 mr-1.5 animate-spin" />
            ) : (
              <Lock className="size-4 mr-1.5" />
            )}
            Change Password
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
