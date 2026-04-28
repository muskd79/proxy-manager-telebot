"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  LayoutDashboard,
  Globe,
  Users,
  FileText,
  MessageSquare,
  History,
  Trash2,
  ScrollText,
  Terminal,
  Shield,
  Settings,
  LogOut,
  Menu,
  ChevronLeft,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { usePendingRequests } from "@/hooks/use-pending-requests";

interface Admin {
  id: string;
  email: string;
  display_name: string;
  role: string;
}

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  minRole?: "super_admin" | "admin";
  section?: string;
}

function NavContent({
  admin,
  collapsed,
  onLogout,
}: {
  admin: Admin;
  collapsed: boolean;
  onLogout: () => void;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  // Wave 22O — realtime pending count + browser notification.
  const { count: pendingCount } = usePendingRequests();

  const navItems: NavItem[] = [
    { title: t("sidebar.dashboard"), href: "/dashboard", icon: LayoutDashboard, section: t("sidebar.operations") },
    { title: t("sidebar.proxies"), href: "/proxies", icon: Globe },
    // Wave 22K — /lots removed per user request. Table stays in DB
    // for FK integrity + historical data; route + nav link gone.
    { title: t("sidebar.categories"), href: "/categories", icon: Shield },
    { title: t("sidebar.users"), href: "/users", icon: Users },
    {
      title: t("sidebar.requests"),
      href: "/requests",
      icon: FileText,
      badge: pendingCount ?? undefined,
    },
    { title: t("sidebar.chat"), href: "/chat", icon: MessageSquare, section: t("sidebar.monitoring") },
    { title: t("sidebar.botSimulator"), href: "/bot-simulator", icon: Terminal },
    { title: t("sidebar.history"), href: "/history", icon: History },
    { title: t("sidebar.logs"), href: "/logs", icon: ScrollText },
    { title: t("sidebar.trash"), href: "/trash", icon: Trash2, section: t("sidebar.system") },
    { title: t("sidebar.admins"), href: "/admins", icon: Shield, minRole: "super_admin" },
    { title: t("sidebar.settings"), href: "/settings", icon: Settings, minRole: "super_admin" },
  ];

  const roleLevel: Record<string, number> = { viewer: 0, admin: 1, super_admin: 2 };
  const filteredItems = navItems.filter((item) => {
    if (!item.minRole) return true;
    return (roleLevel[admin.role] ?? 0) >= (roleLevel[item.minRole] ?? 0);
  });

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-border/50 px-4">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Globe className="h-4 w-4" />
          </div>
          {!collapsed && (
            <span className="text-sm font-semibold tracking-tight">
              Proxy Manager
            </span>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 px-2 py-3">
        <nav className="flex flex-col gap-0.5">
          {filteredItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <div key={item.href}>
                {item.section && !collapsed && (
                  <div className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    {item.section}
                  </div>
                )}
                {item.section && collapsed && (
                  <div className="mt-3 mb-1 mx-2 border-t border-border/30" />
                )}
              <Link
                href={item.href}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  collapsed && "justify-center px-2"
                )}
              >
                <item.icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-accent-foreground"
                  )}
                />
                {!collapsed && (
                  <>
                    <span className="flex-1">{item.title}</span>
                    {item.badge !== undefined && item.badge > 0 && (
                      <Badge
                        variant="default"
                        className="h-5 min-w-5 px-1.5 text-xs bg-primary text-primary-foreground"
                        aria-label={`${item.badge} chưa duyệt`}
                      >
                        {item.badge > 99 ? "99+" : item.badge}
                      </Badge>
                    )}
                  </>
                )}
                {/* Wave 22O — collapsed sidebar shows pulse dot if badge > 0 */}
                {collapsed && item.badge !== undefined && item.badge > 0 && (
                  <span
                    className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary"
                    aria-label={`${item.badge} chưa duyệt`}
                  />
                )}
              </Link>
              </div>
            );
          })}
        </nav>
      </ScrollArea>

      {/* User info + logout */}
      <div className="border-t border-border/50 p-3">
        <div
          className={cn(
            "flex items-center gap-3",
            collapsed && "flex-col"
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase text-muted-foreground">
            {admin.display_name.charAt(0)}
          </div>
          {!collapsed && (
            <div className="flex-1 truncate">
              <p className="truncate text-sm font-medium">{admin.display_name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {admin.email}
              </p>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onLogout}
            aria-label="Đăng xuất"
            className={cn("shrink-0 min-h-11 min-w-11 p-0")}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({ admin }: { admin: Admin }) {
  const [collapsed, setCollapsed] = useState(false);
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    toast.success("Logged out successfully");
    router.push("/login");
    router.refresh();
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden border-r border-border/50 bg-card transition-all duration-300 md:flex md:flex-col",
          collapsed ? "w-16" : "w-60"
        )}
      >
        <div className="relative flex-1">
          <NavContent admin={admin} collapsed={collapsed} onLogout={handleLogout} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"}
            aria-expanded={!collapsed}
            className="absolute -right-3 top-16 z-10 h-6 w-6 rounded-full border bg-card p-0 shadow-sm"
          >
            <ChevronLeft
              className={cn(
                "h-3 w-3 transition-transform",
                collapsed && "rotate-180"
              )}
            />
          </Button>
        </div>
      </aside>

      {/* Mobile sidebar */}
      <Sheet>
        <SheetTrigger
          aria-label="Mở thanh điều hướng"
          className="fixed left-3 top-2 z-40 flex h-11 w-11 items-center justify-center rounded-lg border bg-card shadow-sm md:hidden"
        >
          <Menu className="h-5 w-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-60 p-0">
          <NavContent admin={admin} collapsed={false} onLogout={handleLogout} />
        </SheetContent>
      </Sheet>
    </>
  );
}
