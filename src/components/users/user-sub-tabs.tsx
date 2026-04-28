"use client";

/**
 * Wave 22U — sub-tabs nested under "Người dùng Bot".
 *
 * Sub-tabs:
 *   - /users     — Danh sách (bot user table, block/approve, etc.)
 *   - /chat      — Tin nhắn   (per-user telegram chat threads)
 *
 * /chat keeps its canonical URL (architect's call: don't redirect —
 * 625 existing tests + bookmark-friendly + back-button intuitive).
 * Both pages render this header so the user sees a single tab group.
 *
 * Future: pass `unreadCount` prop into the Tin nhắn tab for the
 * badge UX agent recommended (Wave 22V).
 */

import { Users as UsersIcon, MessageSquare } from "lucide-react";
import { PageSubTabs, type PageSubTabItem } from "@/components/navigation/page-sub-tabs";

interface UserSubTabsProps {
  /** Optional unread message count for the Tin nhắn badge. */
  unreadCount?: number;
}

export function UserSubTabs({ unreadCount }: UserSubTabsProps = {}) {
  const tabs: readonly PageSubTabItem[] = [
    {
      href: "/users",
      labelKey: "userTabs.list",
      icon: UsersIcon,
      // /users, /users/[id] both map to Danh sách
      match: (path) => path === "/users" || path.startsWith("/users/"),
    },
    {
      href: "/chat",
      labelKey: "userTabs.messages",
      icon: MessageSquare,
      badge: unreadCount,
    },
  ];
  return <PageSubTabs tabs={tabs} ariaLabel="Người dùng Bot" />;
}
