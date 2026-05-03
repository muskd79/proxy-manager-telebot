"use client";

/**
 * Wave 26-D-pre1 (gap C1, synthesis from multi-agent brainstorm 2026-05-03).
 *
 * Storyteller-layout timeline for proxy detail. Renders every relevant
 * event in chronological order (newest first) with filter chips so the
 * admin can drill into one category. Pre-fix the detail page only had a
 * thin "Assignment History" table fetched from /api/requests — admin had
 * NO way to see admin actions, status changes, edits, or warranty
 * events. User feedback: "1 proxy có thể giao cho vài người, người này
 * báo proxy lỗi xong có khi tao lại giao proxy cho người khác — cần
 * biết lịch sử chi tiết, ai giao ai dùng khi nào, mọi thay đổi".
 *
 * In Wave 26-D-pre1 (this commit) the timeline merges TWO data sources
 * to approximate the future `proxy_events` table:
 *   - /api/requests?proxyId=…    → user request lifecycle events
 *                                   (request_created / approved /
 *                                   rejected / assigned)
 *   - /api/logs?resourceType=proxy&resourceId=… → admin actions
 *                                   (proxy.create / .update / .delete /
 *                                   .bulk_edit / .import) + bot events
 *                                   (proxy_auto_assigned, proxy_revoked)
 *
 * In Wave 26-D itself (next branch) we add migration 057 with the
 * dedicated `proxy_events` table and switch this component to fetch
 * from /api/proxies/[id]/events. The component contract stays the same
 * — the parent passes `events: TimelineEvent[]` already merged.
 *
 * Filter chips (top of timeline):
 *   - "Tất cả" (default)
 *   - "Yêu cầu" — only proxy_request_* / approved / rejected
 *   - "Giao / Thu hồi" — only assigned / unassigned events
 *   - "Sửa" — only proxy.update / proxy.bulk_edit
 *   - "Hệ thống" — only proxy.create / .delete / .import / cron
 *
 * Mobile: chip row scrolls horizontally; timeline list stays vertical.
 *
 * Empty state: when no events match a filter → "Không có sự kiện nào
 * khớp" + a "Tất cả" reset button. Total empty (no events at all) →
 * helpful "Proxy này chưa có hoạt động nào" + nút quay lại danh sách.
 */

import { useState, useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatRelativeWithTitle } from "@/lib/format-time";
import {
  CheckCircle2,
  XCircle,
  UserPlus,
  UserMinus,
  Pencil,
  Plus,
  Trash2,
  PackageOpen,
  AlertTriangle,
  Activity,
  RotateCcw,
  Sparkles,
  Filter,
} from "lucide-react";

/**
 * Normalised timeline event. The parent merges activity_logs +
 * proxy_requests rows into this shape so the UI doesn't need to
 * know the data sources.
 */
export interface TimelineEvent {
  id: string;
  /** Internal kind, drives icon + color + label generation. */
  kind:
    | "request_created"      // user clicked /getproxy
    | "request_approved"     // admin clicked Duyệt
    | "request_rejected"     // admin clicked Từ chối
    | "request_auto_approved" // auto-approve mode
    | "request_expired"      // cron expired the pending request
    | "assigned"             // proxy distributed (proxy_auto_assigned + admin_assign)
    | "unassigned"           // proxy revoked (user /return + admin unassign)
    | "edited"               // admin edited the proxy fields
    | "bulk_edited"          // proxy was part of a bulk-edit
    | "imported"             // proxy was created via /api/proxies/import
    | "created"              // proxy was created via single-add
    | "soft_deleted"         // moved to trash
    | "restored"             // restored from trash
    | "health_check_failed"  // (Wave 26-D will fill this from proxy_health_logs)
    | "warranty_reported"    // (Wave 26-D)
    | "warranty_approved"    // (Wave 26-D)
    | "warranty_rejected"    // (Wave 26-D)
    | "admin_note"           // (Wave 26-D — manual note from admin)
    | "other";
  /** ISO timestamp. */
  at: string;
  /** Display name of the actor (admin or tele_user). */
  actorLabel: string | null;
  /** Optional href for actor (e.g. /admins/<id> or /users/<id>). */
  actorHref?: string | null;
  /** One-line description, fully Vietnamese. */
  summary: string;
  /** Optional structured details from the source row. */
  details?: Record<string, unknown> | null;
  /** Optional secondary link displayed inline (e.g. "Mở yêu cầu"). */
  cta?: { label: string; href: string } | null;
}

interface TimelineProps {
  events: TimelineEvent[];
  /** Loading state — render skeleton placeholders. */
  loading?: boolean;
  /** Error from upstream fetch. */
  errorText?: string | null;
}

interface FilterChip {
  key: "all" | "request" | "assignment" | "edit" | "system" | "warranty" | "health";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  matches: (e: TimelineEvent) => boolean;
}

const FILTERS: readonly FilterChip[] = [
  {
    key: "all",
    label: "Tất cả",
    icon: Filter,
    matches: () => true,
  },
  {
    key: "request",
    label: "Yêu cầu",
    icon: Sparkles,
    matches: (e) => e.kind.startsWith("request_"),
  },
  {
    key: "assignment",
    label: "Giao / Thu hồi",
    icon: UserPlus,
    matches: (e) => e.kind === "assigned" || e.kind === "unassigned",
  },
  {
    key: "edit",
    label: "Sửa",
    icon: Pencil,
    matches: (e) => e.kind === "edited" || e.kind === "bulk_edited",
  },
  {
    key: "warranty",
    label: "Bảo hành",
    icon: AlertTriangle,
    matches: (e) =>
      e.kind === "warranty_reported" ||
      e.kind === "warranty_approved" ||
      e.kind === "warranty_rejected",
  },
  {
    key: "health",
    label: "Sức khỏe",
    icon: Activity,
    matches: (e) => e.kind === "health_check_failed",
  },
  {
    key: "system",
    label: "Hệ thống",
    icon: PackageOpen,
    matches: (e) =>
      e.kind === "created" ||
      e.kind === "imported" ||
      e.kind === "soft_deleted" ||
      e.kind === "restored",
  },
] as const;

interface IconStyle {
  Icon: React.ComponentType<{ className?: string }>;
  /** Tailwind class for the icon color. */
  tone: string;
  /** Background of the dot badge behind the icon. */
  dotBg: string;
}

const ICON_BY_KIND: Record<TimelineEvent["kind"], IconStyle> = {
  request_created: { Icon: Sparkles, tone: "text-blue-600 dark:text-blue-400", dotBg: "bg-blue-100 dark:bg-blue-900/40" },
  request_approved: { Icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400", dotBg: "bg-emerald-100 dark:bg-emerald-900/40" },
  request_rejected: { Icon: XCircle, tone: "text-red-600 dark:text-red-400", dotBg: "bg-red-100 dark:bg-red-900/40" },
  request_auto_approved: { Icon: Sparkles, tone: "text-emerald-600 dark:text-emerald-400", dotBg: "bg-emerald-100 dark:bg-emerald-900/40" },
  request_expired: { Icon: XCircle, tone: "text-muted-foreground", dotBg: "bg-muted" },
  assigned: { Icon: UserPlus, tone: "text-blue-600 dark:text-blue-400", dotBg: "bg-blue-100 dark:bg-blue-900/40" },
  unassigned: { Icon: UserMinus, tone: "text-amber-600 dark:text-amber-400", dotBg: "bg-amber-100 dark:bg-amber-900/40" },
  edited: { Icon: Pencil, tone: "text-purple-600 dark:text-purple-400", dotBg: "bg-purple-100 dark:bg-purple-900/40" },
  bulk_edited: { Icon: Pencil, tone: "text-purple-600 dark:text-purple-400", dotBg: "bg-purple-100 dark:bg-purple-900/40" },
  imported: { Icon: PackageOpen, tone: "text-cyan-600 dark:text-cyan-400", dotBg: "bg-cyan-100 dark:bg-cyan-900/40" },
  created: { Icon: Plus, tone: "text-emerald-600 dark:text-emerald-400", dotBg: "bg-emerald-100 dark:bg-emerald-900/40" },
  soft_deleted: { Icon: Trash2, tone: "text-red-600 dark:text-red-400", dotBg: "bg-red-100 dark:bg-red-900/40" },
  restored: { Icon: RotateCcw, tone: "text-emerald-600 dark:text-emerald-400", dotBg: "bg-emerald-100 dark:bg-emerald-900/40" },
  health_check_failed: { Icon: Activity, tone: "text-amber-600 dark:text-amber-400", dotBg: "bg-amber-100 dark:bg-amber-900/40" },
  warranty_reported: { Icon: AlertTriangle, tone: "text-amber-600 dark:text-amber-400", dotBg: "bg-amber-100 dark:bg-amber-900/40" },
  warranty_approved: { Icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400", dotBg: "bg-emerald-100 dark:bg-emerald-900/40" },
  warranty_rejected: { Icon: XCircle, tone: "text-red-600 dark:text-red-400", dotBg: "bg-red-100 dark:bg-red-900/40" },
  admin_note: { Icon: Pencil, tone: "text-blue-600 dark:text-blue-400", dotBg: "bg-blue-100 dark:bg-blue-900/40" },
  other: { Icon: Filter, tone: "text-muted-foreground", dotBg: "bg-muted" },
};

function EventRow({ event }: { event: TimelineEvent }) {
  const style = ICON_BY_KIND[event.kind] ?? ICON_BY_KIND.other;
  const Icon = style.Icon;
  const meta = formatRelativeWithTitle(event.at);

  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {/* Connector line — vertical thread tying events together */}
      <span
        aria-hidden="true"
        className="absolute left-[15px] top-8 -bottom-1 w-px bg-border/70 last:hidden"
      />
      {/* Dot + icon */}
      <span
        className={cn(
          "relative z-[1] mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border/60",
          style.dotBg,
        )}
        aria-hidden="true"
      >
        <Icon className={cn("size-4", style.tone)} />
      </span>
      {/* Body */}
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="text-sm leading-snug">{event.summary}</p>
          {event.cta && (
            <Link
              href={event.cta.href}
              className="text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              {event.cta.label} →
            </Link>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {event.actorLabel && (
            event.actorHref ? (
              <Link href={event.actorHref} className="hover:underline">
                {event.actorLabel}
              </Link>
            ) : (
              <span>{event.actorLabel}</span>
            )
          )}
          <span title={meta.absolute}>{meta.relative}</span>
        </div>
      </div>
    </li>
  );
}

function SkeletonRow({ idx }: { idx: number }) {
  return (
    <li className="relative flex gap-3 pb-4" aria-hidden="true">
      <span className="absolute left-[15px] top-8 -bottom-1 w-px bg-border/40" />
      <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted" />
      <div className="flex-1 space-y-2 pt-1">
        <div
          className={cn(
            "h-3 animate-pulse rounded bg-muted",
            idx % 2 === 0 ? "w-3/4" : "w-2/3",
          )}
        />
        <div className="h-2 w-1/3 animate-pulse rounded bg-muted/70" />
      </div>
    </li>
  );
}

export function Timeline({ events, loading = false, errorText }: TimelineProps) {
  const [activeFilter, setActiveFilter] = useState<FilterChip["key"]>("all");

  const filtered = useMemo(() => {
    const chip = FILTERS.find((f) => f.key === activeFilter);
    if (!chip) return events;
    return events.filter(chip.matches);
  }, [events, activeFilter]);

  // Build per-filter counts so admins know what's hiding behind each
  // chip without clicking through.
  const counts = useMemo(() => {
    const result: Record<FilterChip["key"], number> = {
      all: events.length,
      request: 0,
      assignment: 0,
      edit: 0,
      warranty: 0,
      health: 0,
      system: 0,
    };
    for (const e of events) {
      for (const f of FILTERS) {
        if (f.key !== "all" && f.matches(e)) {
          result[f.key]++;
        }
      }
    }
    return result;
  }, [events]);

  return (
    <section className="rounded-lg border bg-card" aria-labelledby="proxy-timeline-heading">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div>
          <h2 id="proxy-timeline-heading" className="text-base font-semibold">
            Lịch sử hoạt động
          </h2>
          <p className="text-xs text-muted-foreground">
            Mọi thay đổi liên quan tới proxy này, mới nhất trên cùng.
          </p>
        </div>
      </header>

      {/* Filter chips */}
      <nav
        aria-label="Bộ lọc lịch sử"
        className="-mx-px overflow-x-auto border-b border-border/60 px-4 py-2"
      >
        <ul className="flex flex-wrap gap-1.5">
          {FILTERS.map((chip) => {
            const ChipIcon = chip.icon;
            const count = counts[chip.key];
            const active = chip.key === activeFilter;
            const disabled = chip.key !== "all" && count === 0;
            return (
              <li key={chip.key}>
                <button
                  type="button"
                  onClick={() => setActiveFilter(chip.key)}
                  disabled={disabled}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/60 bg-background hover:bg-muted/40",
                    disabled && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <ChipIcon className="size-3.5" aria-hidden="true" />
                  <span>{chip.label}</span>
                  {chip.key !== "all" && (
                    <Badge
                      variant={active ? "secondary" : "outline"}
                      className="h-4 px-1.5 text-[10px] font-semibold tabular-nums"
                    >
                      {count}
                    </Badge>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Body */}
      <div className="px-4 py-4">
        {errorText ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {errorText}
          </p>
        ) : loading ? (
          <ul role="list">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonRow key={i} idx={i} />
            ))}
          </ul>
        ) : filtered.length === 0 ? (
          activeFilter === "all" ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Proxy này chưa có hoạt động nào.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Lịch sử sẽ xuất hiện khi proxy được giao, sửa hoặc thu hồi.
              </p>
            </div>
          ) : (
            <div className="py-6 text-center">
              <p className="text-sm text-muted-foreground">
                Không có sự kiện nào khớp với bộ lọc này.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setActiveFilter("all")}
              >
                Xem tất cả ({events.length})
              </Button>
            </div>
          )
        ) : (
          <ul role="list" aria-label={`${filtered.length} sự kiện`}>
            {filtered.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
