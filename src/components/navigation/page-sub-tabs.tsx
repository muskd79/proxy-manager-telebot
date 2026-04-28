"use client";

/**
 * Wave 22U — generic page-level sub-tabs.
 *
 * Why a primitive: we now have 3 parents that need sub-tab navigation
 * (Quản lý proxy / Người dùng Bot / Quản lý Bot) and likely more
 * (logs already does this inline, settings could). Without a single
 * primitive, the active-state matching, accessibility, mobile
 * touch-target, and styling would copy-paste 3+ times — exactly the
 * fragmentation that breaks when devs touch one and forget the
 * others.
 *
 * Domain wrappers (ProxySubTabs / UserSubTabs / BotSubTabs) declare
 * their tab list with TranslationKey-typed labels and pass through
 * to this primitive. Adding a new sub-tab parent = new wrapper file
 * with ~10 lines, no new layout code.
 *
 * Active-state semantics:
 *   - `match: "exact"`   — pathname === href (used for default tab
 *                         when other tabs share a prefix)
 *   - `match: "prefix"`  — pathname.startsWith(href) — most common
 *   - `match: (path) =>` — custom (e.g. /proxies + /proxies/[id]
 *                         + /proxies/import all map to one tab)
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useI18n, type TranslationKey } from "@/lib/i18n";

export interface PageSubTabItem {
  /** Destination URL. */
  href: string;
  /** i18n key, type-checked against en.json structure. */
  labelKey: TranslationKey;
  /** Lucide-react icon component. */
  icon: React.ComponentType<{ className?: string }>;
  /**
   * Active-state matcher. Default "prefix".
   * Pass a function for custom logic (e.g. multi-prefix groups).
   */
  match?: "exact" | "prefix" | ((pathname: string) => boolean);
  /** Optional badge count rendered to the right of the label. */
  badge?: number;
}

interface PageSubTabsProps {
  tabs: readonly PageSubTabItem[];
  /** aria-label for the nav landmark. Required for screen readers. */
  ariaLabel: string;
}

function isActive(tab: PageSubTabItem, pathname: string): boolean {
  if (typeof tab.match === "function") return tab.match(pathname);
  if (tab.match === "exact") return pathname === tab.href;
  // Default: prefix match. Strip query/hash via pathname (already clean).
  return pathname === tab.href || pathname.startsWith(tab.href + "/");
}

export function PageSubTabs({ tabs, ariaLabel }: PageSubTabsProps) {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <nav
      aria-label={ariaLabel}
      className="flex items-center gap-1 overflow-x-auto border-b border-border/50 px-1"
    >
      {tabs.map((tab) => {
        const active = isActive(tab, pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors",
              "min-h-11", // WCAG AA touch target
              active
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <tab.icon className="h-4 w-4" />
            {t(tab.labelKey)}
            {typeof tab.badge === "number" && tab.badge > 0 && (
              <span
                className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs text-primary-foreground"
                aria-label={`${tab.badge} mới`}
              >
                {tab.badge > 99 ? "99+" : tab.badge}
              </span>
            )}
            {active && (
              <span
                aria-hidden
                className="absolute inset-x-0 -bottom-px h-0.5 bg-primary"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
