"use client";

/**
 * Wave 26-D-pre1 (gap D1, synthesis from multi-agent brainstorm 2026-05-03).
 *
 * Storyteller layout for the proxy detail page. Replaces the 288-line
 * monolithic ProxyDetail component (mixed English/Vietnamese, missing
 * half the metadata, single Assignment History table). New layout:
 *
 *   ┌────────── Header (host:port + status + strip + chips + actions)
 *   ├────────── 2-column body
 *   │             left  = Timeline (primary view, filterable)
 *   │             right = MetadataRail (Connection/Mua bán/Phân phối/...)
 *   └──────────
 *
 * On mobile the rail collapses ABOVE the timeline (default open) so
 * admins keep the metadata in screen reach without scrolling past
 * the timeline first.
 *
 * Component contract (props): a parent page fetches:
 *   - the proxy itself (Proxy)
 *   - the timeline events (TimelineEvent[]) — already merged by the
 *     parent from /api/requests + /api/logs
 *   - health probes (ProxyHealthProbe[]) — pre1 will be empty or 1-element
 *   - the category display name
 * and provides callbacks for every action (edit / health check /
 * unassign / set status / soft delete / restore / toggle hidden).
 *
 * This composer doesn't fetch — staying pure makes it easy to test
 * with vitest + react-testing-library and to swap in proxy_events
 * later without touching the layout.
 */

import type { Proxy } from "@/types/database";
import { ProxyDetailHeader } from "./header";
import { MetadataRail } from "./metadata-rail";
import { Timeline, type TimelineEvent } from "./timeline";
import type { ProxyHealthProbe } from "./health-strip";

export type { TimelineEvent } from "./timeline";
export type { ProxyHealthProbe } from "./health-strip";

interface ProxyDetailProps {
  proxy: Proxy;
  canWrite: boolean;
  /** Pre-merged + sorted (newest first) events. */
  timelineEvents: TimelineEvent[];
  /** Loading state for the timeline. */
  timelineLoading?: boolean;
  /** Optional error from upstream timeline fetch. */
  timelineError?: string | null;
  /** Last 20 health probes. Empty in pre1 if we can't synthesize from last_checked_at. */
  healthProbes: ProxyHealthProbe[];
  /** Category display name. */
  categoryName?: string | null;
  // ── Action callbacks ──
  onEdit: () => void;
  onHealthCheck: () => Promise<void> | void;
  onToggleHidden: (next: boolean) => Promise<void>;
  onSoftDelete: () => Promise<void>;
  onSetStatus: (next: Proxy["status"], reason: string | null) => Promise<void>;
  onUnassign: (reason: string | null) => Promise<void>;
  onRestoreFromTrash: () => Promise<void>;
}

export function ProxyDetail({
  proxy,
  canWrite,
  timelineEvents,
  timelineLoading,
  timelineError,
  healthProbes,
  categoryName,
  onEdit,
  onHealthCheck,
  onToggleHidden,
  onSoftDelete,
  onSetStatus,
  onUnassign,
  onRestoreFromTrash,
}: ProxyDetailProps) {
  return (
    <div className="space-y-4 sm:space-y-6">
      <ProxyDetailHeader
        proxy={proxy}
        canWrite={canWrite}
        healthProbes={healthProbes}
        categoryName={categoryName}
        onEdit={onEdit}
        onHealthCheck={onHealthCheck}
        onToggleHidden={onToggleHidden}
        onSoftDelete={onSoftDelete}
        onSetStatus={onSetStatus}
        onUnassign={onUnassign}
        onRestoreFromTrash={onRestoreFromTrash}
      />

      {/*
        Storyteller body: 2-column on desktop, stack on mobile.
        Metadata rail goes FIRST in DOM order (so screen readers
        get the field summary first), but visually flips to the
        right via order classes — admin scans timeline ↔ rail
        with eye movement, not scroll.

        On mobile (< lg) the rail comes BEFORE the timeline since
        admin usually wants the field overview before reading the
        history; long timelines push the rail offscreen otherwise.
      */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-6">
        <div className="lg:order-1 min-w-0">
          <Timeline
            events={timelineEvents}
            loading={timelineLoading}
            errorText={timelineError}
          />
        </div>
        <div className="lg:order-2">
          <MetadataRail
            proxy={proxy}
            categoryName={categoryName}
            canWrite={canWrite}
          />
        </div>
      </div>
    </div>
  );
}
