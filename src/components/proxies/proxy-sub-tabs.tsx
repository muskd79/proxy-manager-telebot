"use client";

/**
 * Wave 22T — sub-tabs nested under "Quản lý proxy".
 *
 * User asked for Categories + Trash to live INSIDE the proxy tab, not
 * as siblings in the sidebar. Each page (/proxies, /categories,
 * /trash) renders this header at the top so the user can swap between
 * them while staying inside the same parent context.
 *
 * Pure Link-based navigation — no client tab state — so deep links
 * still work and refresh keeps you on the same sub-tab.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Globe, FolderTree, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n, type TranslationKey } from "@/lib/i18n";

interface SubTab {
  href: string;
  labelKey: TranslationKey;
  icon: React.ComponentType<{ className?: string }>;
}

const tabs: SubTab[] = [
  { href: "/proxies", labelKey: "proxyTabs.list", icon: Globe },
  { href: "/categories", labelKey: "proxyTabs.categories", icon: FolderTree },
  { href: "/trash", labelKey: "proxyTabs.trash", icon: Trash2 },
];

export function ProxySubTabs() {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <nav
      aria-label="Quản lý proxy"
      className="flex items-center gap-1 border-b border-border/50 px-1"
    >
      {tabs.map((tab) => {
        // Match /proxies, /proxies/[id], /proxies/import all to the
        // first tab. /categories and /trash use exact-prefix.
        const isActive =
          tab.href === "/proxies"
            ? pathname === "/proxies" || pathname.startsWith("/proxies/")
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors",
              "min-h-11", // touch target
              isActive
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <tab.icon className="h-4 w-4" />
            {t(tab.labelKey)}
            {isActive && (
              <span
                className="absolute inset-x-0 -bottom-px h-0.5 bg-primary"
                aria-hidden
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
