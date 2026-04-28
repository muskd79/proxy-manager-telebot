"use client";

/**
 * Wave 22U — refactored to use the shared <PageSubTabs> primitive.
 *
 * Sub-tabs nested under "Quản lý proxy":
 *   - /proxies       — Danh sách proxy (also matches /proxies/[id], /proxies/import)
 *   - /categories    — Danh mục
 *   - /trash         — Thùng rác
 */

import { Globe, FolderTree, Trash2 } from "lucide-react";
import { PageSubTabs, type PageSubTabItem } from "@/components/navigation/page-sub-tabs";

const tabs: readonly PageSubTabItem[] = [
  {
    href: "/proxies",
    labelKey: "proxyTabs.list",
    icon: Globe,
    // /proxies, /proxies/123, /proxies/import all light up "Danh sách proxy"
    match: (path) => path === "/proxies" || path.startsWith("/proxies/"),
  },
  { href: "/categories", labelKey: "proxyTabs.categories", icon: FolderTree },
  { href: "/trash", labelKey: "proxyTabs.trash", icon: Trash2 },
];

export function ProxySubTabs() {
  return <PageSubTabs tabs={tabs} ariaLabel="Quản lý proxy" />;
}
