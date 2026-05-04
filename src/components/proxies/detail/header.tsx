"use client";

/**
 * Wave 26-D-pre1 — proxy detail page header band.
 *
 * Shows host:port (large, mono), the consolidated status badge from
 * proxyStatusBadges(), the inline 20-dot health strip, the chip row
 * (country / category / import batch / warranty cross-link), and the
 * QuickActions row. Designed to be the FIRST thing admin sees, with
 * everything important addressable in one screen-height.
 *
 * Mobile: chip row wraps; quick-actions row collapses to primary
 * action + ⋯ overflow (handled inside QuickActions).
 *
 * Wave 26-D will add the warranty cross-link chip (`replacement_for`
 * / `replaced_by`) once the proxy_events table ships. For pre1 the
 * cross-link is a placeholder that hides when the data is absent.
 */

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Globe, Folder, Package, ArrowLeftRight } from "lucide-react";
import type { Proxy } from "@/types/database";
import { proxyStatusBadges } from "@/lib/proxy-labels";
import { HealthStrip, type ProxyHealthProbe } from "./health-strip";
import { QuickActions } from "./quick-actions";

interface ProxyDetailHeaderProps {
  proxy: Proxy;
  canWrite: boolean;
  /** Last 20 health probes (oldest → newest). For pre1 this is usually
   * empty or a single synthetic from `last_checked_at`. */
  healthProbes: ProxyHealthProbe[];
  /** Display name of the category, if `proxy.category_id` is set. */
  categoryName?: string | null;
  /** Action callbacks forwarded to QuickActions. */
  onEdit: () => void;
  onHealthCheck: () => Promise<void> | void;
  onToggleHidden: (next: boolean) => Promise<void>;
  onSoftDelete: () => Promise<void>;
  onSetStatus: (next: Proxy["status"], reason: string | null) => Promise<void>;
  onUnassign: (reason: string | null) => Promise<void>;
  onRestoreFromTrash: () => Promise<void>;
  /** When clicking the strip — caller usually scrolls to / opens health tab. */
  onHealthStripClick?: () => void;
}

const TYPE_BADGE_COLORS: Record<string, string> = {
  http: "bg-cyan-100 text-cyan-900 border-cyan-300 dark:bg-cyan-900/40 dark:text-cyan-100 dark:border-cyan-700",
  https: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-700",
  socks5: "bg-purple-100 text-purple-900 border-purple-300 dark:bg-purple-900/40 dark:text-purple-100 dark:border-purple-700",
};

export function ProxyDetailHeader({
  proxy,
  canWrite,
  healthProbes,
  categoryName,
  onEdit,
  onHealthCheck,
  onToggleHidden,
  onSoftDelete,
  onSetStatus,
  onUnassign,
  onRestoreFromTrash,
  onHealthStripClick,
}: ProxyDetailHeaderProps) {
  const statusBadges = proxyStatusBadges(proxy);

  return (
    <section
      className="rounded-lg border bg-card p-4 sm:p-6"
      aria-label="Tổng quan proxy"
    >
      {/* ─── Title row: host:port + status + protocol ─── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-semibold tracking-tight sm:text-2xl select-all">
              {proxy.host}:{proxy.port}
            </h1>
            {/* Protocol badge */}
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium uppercase ${
                TYPE_BADGE_COLORS[proxy.type] ?? ""
              }`}
            >
              {proxy.type}
            </span>
            {/* Lifecycle status badge */}
            {statusBadges.map((b, i) => (
              <Badge
                key={`${b.label}-${i}`}
                variant={b.variant}
                className={b.tone === "muted" ? "opacity-70" : ""}
              >
                {b.label}
              </Badge>
            ))}
          </div>

          {/* Chip row — clickable links to relevant filtered views */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
            {proxy.country && (
              <Link
                href={`/proxies?country=${encodeURIComponent(proxy.country)}`}
                className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-0.5 hover:bg-muted/70"
                aria-label={`Lọc danh sách proxy theo quốc gia ${proxy.country}`}
              >
                <Globe className="size-3" aria-hidden="true" />
                <span>{proxy.country}</span>
              </Link>
            )}
            {proxy.category_id && (
              <Link
                href={`/proxies?category_id=${proxy.category_id}`}
                className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-0.5 hover:bg-muted/70"
                aria-label="Lọc danh sách proxy theo danh mục"
              >
                <Folder className="size-3" aria-hidden="true" />
                <span>{categoryName ?? "Mở danh mục"}</span>
              </Link>
            )}
            {proxy.import_batch_id && (
              <Link
                href={`/proxies?import_batch_id=${proxy.import_batch_id}`}
                className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-0.5 hover:bg-muted/70"
                aria-label="Mở lô import"
              >
                <Package className="size-3" aria-hidden="true" />
                <span>Lô {proxy.import_batch_id.slice(0, 8)}…</span>
              </Link>
            )}
            {/* Wave 26-D placeholder — warranty cross-link chip.
                Hidden in pre1 because we have no replacement linkage data
                yet. The structure is ready: when proxy_events ships with
                event_type='warranty_replacement_for', the page hydrates
                this chip with the originating/replacement proxy id. */}
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(proxy as any).warranty_replacement_for && (
              <Link
                /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
                href={`/proxies/${(proxy as any).warranty_replacement_for}`}
                className="inline-flex items-center gap-1 rounded-full border border-amber-400 bg-amber-50 px-2.5 py-0.5 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-100"
                aria-label="Mở proxy gốc đã được thay thế"
              >
                <ArrowLeftRight className="size-3" aria-hidden="true" />
                <span>Thay thế cho proxy gốc</span>
              </Link>
            )}
          </div>
        </div>

        {/* Health strip (right-aligned on desktop, below on mobile) */}
        <div className="shrink-0">
          <HealthStrip probes={healthProbes} onClick={onHealthStripClick} />
        </div>
      </div>

      {/* ─── Quick actions row ─── */}
      <div className="mt-4 border-t border-border/60 pt-4">
        <QuickActions
          proxy={proxy}
          canWrite={canWrite}
          onEdit={onEdit}
          onHealthCheck={onHealthCheck}
          onToggleHidden={onToggleHidden}
          onSoftDelete={onSoftDelete}
          onSetStatus={onSetStatus}
          onUnassign={onUnassign}
          onRestoreFromTrash={onRestoreFromTrash}
        />
      </div>
    </section>
  );
}
