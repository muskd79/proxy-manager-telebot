"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Bell, LogOut, User, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { SearchInput } from "@/components/shared/search-input";
import { LanguageSwitch } from "@/components/shared/language-switch";
import { useI18n } from "@/lib/i18n";

interface Admin {
  id: string;
  email: string;
  display_name: string;
  role: string;
}

export function Header({ admin }: { admin: Admin }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const fetchPending = () => {
      fetch("/api/requests?status=pending&pageSize=1")
        .then(r => r.json())
        .then(d => setPendingCount(d?.data?.total || 0))
        .catch(() => {});
    };

    fetchPending();

    const interval = setInterval(fetchPending, 30000);
    return () => clearInterval(interval);
  }, []);

  // Realtime sync: notification updates on proxy_requests changes (debounced to reduce load)
  const headerDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("pending-requests")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "proxy_requests" }, () => {
        clearTimeout(headerDebounceRef.current);
        headerDebounceRef.current = setTimeout(() => {
          fetch("/api/requests?status=pending&pageSize=1")
            .then(r => r.json())
            .then(d => setPendingCount(d?.data?.total || 0))
            .catch(() => {});
        }, 2000);
      })
      .subscribe();

    return () => {
      clearTimeout(headerDebounceRef.current);
      supabase.removeChannel(channel);
    };
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    toast.success("Logged out successfully");
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border/50 bg-card/50 px-4 backdrop-blur-sm md:px-6">
      {/* Breadcrumb - hidden on mobile to make room for hamburger */}
      <div className="hidden flex-1 md:block">
        <Breadcrumb />
      </div>
      <div className="flex-1 md:hidden" />

      {/* Search */}
      <div className="hidden w-64 lg:block">
        <SearchInput
          placeholder="Search..."
          onSearch={(query) => {
            if (query) {
              router.push(`/dashboard?search=${encodeURIComponent(query)}`);
            }
          }}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <LanguageSwitch />

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="sm"
          aria-label={theme === "dark" ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối"}
          className="shrink-0 min-h-11 min-w-11 p-0"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? (
            <Sun className="size-4" />
          ) : (
            <Moon className="size-4" />
          )}
        </Button>

        {/* Notifications */}
        <Button
          variant="ghost"
          size="sm"
          aria-label={
            pendingCount > 0
              ? `Thông báo: ${pendingCount} yêu cầu đang chờ`
              : "Thông báo"
          }
          className="relative min-h-11 min-w-11 p-0"
        >
          <Bell className="h-4 w-4" />
          {pendingCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
              {pendingCount > 99 ? "99+" : pendingCount}
            </span>
          )}
        </Button>

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Mở menu tài khoản của ${admin.display_name}`}
            className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-accent focus:outline-none min-h-11"
          >
            <Avatar className="h-7 w-7">
              <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                {admin.display_name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-sm font-medium md:inline">
              {admin.display_name}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{admin.display_name}</p>
              <p className="text-xs text-muted-foreground">{admin.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/profile")}>
              <User className="mr-2 h-4 w-4" />
              {t("common.profile")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              {t("common.logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
