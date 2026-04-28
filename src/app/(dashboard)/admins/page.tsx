"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { RefreshCw, Plus, Shield, ShieldAlert, Eye, ShieldOff } from "lucide-react";
import { useRole } from "@/lib/role-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface AdminData {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  telegram_id: number | null;
  last_login_at: string | null;
  created_at: string;
}

const roleIcons: Record<string, React.ReactNode> = {
  super_admin: <ShieldAlert className="size-4" />,
  admin: <Shield className="size-4" />,
  viewer: <Eye className="size-4" />,
};

const roleBadgeVariant: Record<
  string,
  "default" | "secondary" | "outline"
> = {
  super_admin: "default",
  admin: "secondary",
  viewer: "outline",
};

export default function AdminsPage() {
  const { canManageAdmins } = useRole();
  const router = useRouter();
  const [admins, setAdmins] = useState<AdminData[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("admin");
  const [inviteLoading, setInviteLoading] = useState(false);

  const fetchAdmins = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings?type=admins");
      if (res.ok) {
        const result = await res.json();
        setAdmins(result.data ?? []);
      }
    } catch (err) {
      console.error("Failed to fetch admins:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAdmins();
  }, [fetchAdmins]);

  const handleInvite = async () => {
    if (!inviteEmail) return;
    setInviteLoading(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "invite_admin",
          email: inviteEmail,
          role: inviteRole,
        }),
      });
      if (res.ok) {
        toast.success("Admin invited successfully");
        setInviteOpen(false);
        setInviteEmail("");
        fetchAdmins();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to invite admin");
      }
    } catch (err) {
      console.error("Failed to invite admin:", err);
      toast.error("Failed to invite admin");
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRoleChange = async (adminId: string, newRole: string) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_admin_role",
          adminId,
          role: newRole,
        }),
      });
      if (res.ok) {
        toast.success("Role updated");
        fetchAdmins();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to update role");
      }
    } catch (err) {
      console.error("Failed to update role:", err);
      toast.error("Failed to update role");
    }
  };

  const handleToggleActive = async (adminId: string, isActive: boolean) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_admin_active",
          adminId,
          is_active: !isActive,
        }),
      });
      if (res.ok) {
        toast.success(isActive ? "Admin deactivated" : "Admin activated");
        fetchAdmins();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to update admin");
      }
    } catch (err) {
      console.error("Failed to update admin:", err);
      toast.error("Failed to update admin");
    }
  };

  if (!canManageAdmins) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <ShieldOff className="size-12 text-muted-foreground" />
        <h1 className="text-2xl font-bold tracking-tight">Access Denied</h1>
        <p className="text-muted-foreground">
          You do not have permission to manage admins. Only super admins can access this page.
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

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Admin Management
          </h1>
          <p className="text-muted-foreground">
            Manage administrators and their roles
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger render={<Button size="sm" />}>
                <Plus className="size-4 mr-1.5" />
                Add Admin
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite Admin</DialogTitle>
                <DialogDescription>
                  Send an invitation to a new administrator.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="admin@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v ?? '')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="super_admin">Super Admin</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setInviteOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleInvite} disabled={inviteLoading}>
                  {inviteLoading ? "Inviting..." : "Send Invitation"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchAdmins}
            disabled={loading}
          >
            <RefreshCw
              className={`size-4 mr-1.5 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Telegram ID</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : admins.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No admins found
                  </TableCell>
                </TableRow>
              ) : (
                admins.map((admin) => (
                  <TableRow key={admin.id}>
                    <TableCell>{admin.email}</TableCell>
                    <TableCell>{admin.full_name ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {admin.telegram_id ?? "-"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={roleBadgeVariant[admin.role] ?? "outline"}
                        className="gap-1"
                      >
                        {roleIcons[admin.role]}
                        {admin.role.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={admin.is_active ? "default" : "destructive"}
                      >
                        {admin.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {admin.last_login_at
                        ? format(new Date(admin.last_login_at), "yyyy-MM-dd HH:mm")
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      {format(new Date(admin.created_at), "yyyy-MM-dd")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Select
                          value={admin.role}
                          onValueChange={(v) => handleRoleChange(admin.id, v ?? '')}
                        >
                          <SelectTrigger className="w-[130px] h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="super_admin">
                              Super Admin
                            </SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="viewer">Viewer</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant={admin.is_active ? "destructive" : "outline"}
                          size="sm"
                          onClick={() =>
                            handleToggleActive(admin.id, admin.is_active)
                          }
                        >
                          {admin.is_active ? "Deactivate" : "Activate"}
                        </Button>
                        {/* Wave 22F-D: link to detail page with force-actions */}
                        <Link href={`/admins/${admin.id}`}>
                          <Button variant="outline" size="sm">
                            Manage
                          </Button>
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
