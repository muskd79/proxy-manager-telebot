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
  ShieldAlert,
  Bot,
  ScrollText,
  Shield,
  Settings,
  LogOut,
  Menu,
  ChevronLeft,
  UserCircle,
  Activity,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { usePendingRequests } from "@/hooks/use-pending-requests";
import { usePendingWarranty } from "@/hooks/use-pending-warranty";

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
  /**
   * Wave 22U — extra paths that should also light up this sidebar
   * entry. Used when a parent menu item owns multiple URL routes
   * (e.g. /users sub-tabs include /chat; /bot owns the legacy
   * /bot-simulator route too).
   */
  altPaths?: readonly string[];
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
  // Wave 26-D-2 — warranty queue badge alongside requests.
  const { count: warrantyCount } = usePendingWarranty();

  // Wave 22U — IA redesign per user feedback (verbatim):
  //   "QUẢN LÝ
  //      Dashboard
  //      Người dùng Bot: tin nhắn chuyển vào trong đây
  //      Quản lý Bot
  //    VIA
  //      Quản lý proxy: danh mục và thùng rác chuyển vào đây
  //      Yêu cầu proxy
  //    HỆ THỐNG
  //      Lịch sử & Nhật ký
  //      Tài khoản Admin
  //      Hồ sơ cá nhân
  //      Cài đặt"
  //
  // Two parallel agents (UX + architect) reviewed and confirmed the
  // structure. UX flagged Tin nhắn discoverability (mitigated by
  // future unread badge on Người dùng Bot) and Profile-in-system
  // (kept per user direction — all account mgmt under HỆ THỐNG).
  //
  // Sub-tab parents:
  //   /users  ↔ /chat            via <UserSubTabs />
  //   /bot    ↔ /bot/{simulator,config}  via <BotSubTabs />
  //   /proxies ↔ /categories ↔ /trash   via <ProxySubTabs />
  const navItems: NavItem[] = [
    // ─── QUẢN LÝ ───
    { title: t("sidebar.dashboard"), href: "/dashboard", icon: LayoutDashboard, section: t("sidebar.groupManage") },
    {
      title: t("sidebar.users"),
      href: "/users",
      icon: Users,
      altPaths: ["/chat"], // Tin nhắn = sub-tab
    },
    // ─── BOT (Phase 3, 2026-05-02 — promoted to its own group per
    //          PM UX review: bot is the user-facing surface, distinct
    //          from admin-side QUẢN LÝ entities) ───
    {
      title: t("sidebar.bot"),
      href: "/bot",
      icon: Bot,
      section: t("sidebar.groupBot"),
      altPaths: ["/bot-simulator"], // legacy URL, redirected to /bot/simulator
    },

    // ─── PROXY (Wave 22V — group renamed VIA → PROXY) ───
    {
      title: t("sidebar.proxies"),
      href: "/proxies",
      icon: Globe,
      section: t("sidebar.groupVia"),
      altPaths: ["/categories", "/trash"], // Danh mục + Thùng rác sub-tabs
    },
    {
      title: t("sidebar.requests"),
      href: "/requests",
      icon: FileText,
      badge: pendingCount ?? undefined,
    },
    // Wave 26-D-2 — warranty queue, sibling to /requests.
    {
      title: "Bảo hành",
      href: "/warranty",
      icon: ShieldAlert,
      badge: warrantyCount ?? undefined,
    },
    {
      // Wave 22V — ad-hoc proxy probe tool (sibling to /proxies, not
      // a sub-tab; admin asked for it as a top-level Proxy entry).
      title: t("sidebar.checkProxy"),
      href: "/check-proxy",
      icon: Activity,
    },

    // ─── HỆ THỐNG ───
    {
      title: t("sidebar.logs"),
      href: "/logs",
      icon: ScrollText,
      section: t("sidebar.groupSystem"),
      altPaths: ["/history"], // /history merged into /logs in Wave 22P
    },
    { title: t("sidebar.admins"), href: "/admins", icon: Shield, minRole: "super_admin" },
    { title: t("sidebar.profile"), href: "/profile", icon: UserCircle },
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
        {/* Wave 25-pre4 (Pass 6.3) — id matches the collapse button's
            aria-controls below so screen readers can target the nav
            region that the button toggles. */}
        <nav id="sidebar-nav-region" className="flex flex-col gap-0.5">
          {filteredItems.map((item) => {
            // Wave 22U — sub-tab parents own multiple URL routes.
            // Match the canonical href + any altPaths declared on
            // the nav item (e.g. /users also matches /chat).
            const matchesPath = (target: string): boolean => {
              if (target === "/dashboard") return pathname === target;
              return pathname === target || pathname.startsWith(target + "/");
            };
            const isActive =
              matchesPath(item.href) ||
              (item.altPaths?.some(matchesPath) ?? false);
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
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  // Wave 25-pre2 (Pass 6.5) — keyboard-only users (Tab nav)
                  // had no visible focus indicator on sidebar items.
                  // focus-visible:ring-* renders ONLY on keyboard focus,
                  // not mouse click — preserves the clean look for mouse
                  // users while restoring the affordance for the rest.
                  "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card",
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
                        // Wave 25-pre2 (Pass 5.A) — pre-fix the aria-label
                        // was hardcoded Vietnamese "{N} chưa duyệt" so en
                        // screen-reader users heard Vietnamese. Now i18n'd
                        // via sidebar.pendingBadge with {count} placeholder.
                        aria-label={t("sidebar.pendingBadge").replace("{count}", String(item.badge))}
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
                    aria-label={t("sidebar.pendingBadge").replace("{count}", String(item.badge))}
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
            // Wave 25-pre4 (Pass 6.3) — point to the nav region this
            // button collapses/expands so screen readers announce the
            // relationship.
            aria-controls="sidebar-nav-region"
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
