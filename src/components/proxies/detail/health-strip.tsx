"use client";

/**
 * Wave 26-D-pre1 (gap B3, synthesis from multi-agent brainstorm 2026-05-03).
 *
 * Inline 20-dot health strip rendered in the proxy detail header. Each
 * dot = one health-check probe. Color encodes the verdict:
 *   - green ●  → probe OK
 *   - red   ●  → probe FAILED
 *   - gray  ○  → no probe data yet (placeholder for the slots that
 *                will fill in once the cron has run 20 times)
 *
 * Hover (tooltip) reveals the per-probe detail: timestamp, verdict,
 * speed_ms, error message. Below the strip we render a "X/Y OK"
 * count + sparkline of speed_ms so admins can scan latency trend
 * at a glance.
 *
 * Wave 26-D-pre1 does NOT yet have the proxy_health_logs table —
 * that ships in migration 057 with Wave 26-D itself. So pre1
 * falls back to the single (last_checked_at + speed_ms) data point
 * exposed on the proxy row, and pads the strip to 20 with grays.
 * When the migration ships, the parent page hydrates this component
 * with the real probe array via the `probes` prop and the strip
 * lights up.
 *
 * Accessibility:
 *   - Each dot is a `<span role="img">` with full text label so
 *     screen readers narrate "Probe 1: OK at 14:22, 142ms".
 *   - The strip itself is a `<ul>` so VoiceOver announces "list of
 *     20 items".
 *   - Color isn't the only signal — the count text + sparkline
 *     trend cover color-blind admins.
 */

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Activity } from "lucide-react";

export interface ProxyHealthProbe {
  /** ISO timestamp of when the probe ran. */
  checked_at: string;
  /** True = probe succeeded, false = failed. */
  ok: boolean;
  /** Round-trip latency in ms when ok=true; null otherwise. */
  speed_ms: number | null;
  /** Short error class (e.g. "timeout", "auth_failed", "connect_refused"). */
  error_msg?: string | null;
}

interface HealthStripProps {
  /** Probes ordered OLDEST → NEWEST. Pre-pad with empty slots if <20. */
  probes: ProxyHealthProbe[];
  /** Optional click handler on the strip — caller usually opens the Sức khỏe tab. */
  onClick?: () => void;
  /** Compact mode — hide the count + sparkline, just render the dots. */
  compact?: boolean;
}

const STRIP_LENGTH = 20;

/**
 * Wave 26-D-pre1 — sparkline of speed_ms across the visible probes.
 * Uses inline SVG (no library dep). Y-axis auto-scales. Failed probes
 * render as a grey vertical tick to keep the line continuous.
 */
function Sparkline({ probes, width = 96, height = 16 }: { probes: ProxyHealthProbe[]; width?: number; height?: number }) {
  const okSpeeds = probes
    .map((p, i) => ({ i, v: p.ok && p.speed_ms != null ? p.speed_ms : null }))
    .filter((p) => p.v != null) as Array<{ i: number; v: number }>;

  if (okSpeeds.length < 2) {
    // Not enough data for a line — render a flat baseline.
    return (
      <svg width={width} height={height} aria-hidden="true">
        <line x1={0} y1={height - 2} x2={width} y2={height - 2} stroke="currentColor" strokeOpacity={0.2} strokeWidth={1} strokeDasharray="2 2" />
      </svg>
    );
  }

  const max = Math.max(...okSpeeds.map((p) => p.v));
  const min = Math.min(...okSpeeds.map((p) => p.v));
  const span = Math.max(1, max - min);

  const xStep = width / Math.max(1, probes.length - 1);
  const points = okSpeeds
    .map(({ i, v }) => {
      const x = i * xStep;
      const y = height - 1 - ((v - min) / span) * (height - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} aria-hidden="true" className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    // dd/MM HH:mm in vi-VN locale
    return d.toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function HealthStrip({ probes, onClick, compact = false }: HealthStripProps) {
  // Pad LEFT with empty placeholders so newest probe is always at the right.
  const padding = Math.max(0, STRIP_LENGTH - probes.length);
  const slots: (ProxyHealthProbe | null)[] = [
    ...Array.from({ length: padding }, () => null),
    ...probes.slice(-STRIP_LENGTH),
  ];

  const okCount = probes.filter((p) => p.ok).length;
  const totalProbes = probes.length;
  const okPct = totalProbes > 0 ? Math.round((okCount / totalProbes) * 100) : null;

  // Tone the OK percentage badge by health bucket — admin scans this column
  // hardest. < 80% = red (degraded), 80–95% = amber, >= 95% = emerald.
  const okTone =
    okPct == null
      ? "muted"
      : okPct >= 95
        ? "ok"
        : okPct >= 80
          ? "warn"
          : "fail";

  const stripBody = (
    <ul
      className="inline-flex items-center gap-0.5"
      role="list"
      aria-label={
        totalProbes > 0
          ? `Lịch sử kiểm tra ${totalProbes} lần gần nhất, ${okCount} thành công`
          : "Chưa có lịch sử kiểm tra"
      }
    >
      {slots.map((probe, idx) => {
        if (!probe) {
          return (
            <li
              key={`empty-${idx}`}
              role="img"
              aria-label="Chưa có dữ liệu"
              className="h-2.5 w-2.5 rounded-full bg-muted/60"
            />
          );
        }
        const stateClass = probe.ok
          ? "bg-emerald-500"
          : "bg-red-500";
        const labelText = probe.ok
          ? `Lần ${idx + 1 - padding}: OK ${probe.speed_ms ?? "?"}ms lúc ${formatTime(probe.checked_at)}`
          : `Lần ${idx + 1 - padding}: Thất bại (${probe.error_msg ?? "lỗi không rõ"}) lúc ${formatTime(probe.checked_at)}`;
        return (
          <Tooltip key={probe.checked_at + idx}>
            <TooltipTrigger render={
              <li
                role="img"
                aria-label={labelText}
                tabIndex={0}
                className={cn(
                  "h-2.5 w-2.5 rounded-full transition-transform hover:scale-150 focus-visible:scale-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  stateClass,
                )}
              />
            } />
            <TooltipContent className="text-xs">
              {labelText}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </ul>
  );

  if (compact) {
    return <TooltipProvider delay={120}>{stripBody}</TooltipProvider>;
  }

  return (
    <TooltipProvider delay={120}>
      <div
        className={cn(
          "inline-flex flex-col gap-1 rounded-md border border-border/60 bg-card/50 px-2.5 py-1.5",
          onClick && "cursor-pointer transition-colors hover:bg-muted/40",
        )}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={
          onClick
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClick();
                }
              }
            : undefined
        }
        aria-label={onClick ? "Mở lịch sử kiểm tra chi tiết" : undefined}
      >
        <div className="flex items-center gap-2">
          <Activity
            className={cn(
              "size-3.5",
              okTone === "ok" && "text-emerald-500",
              okTone === "warn" && "text-amber-500",
              okTone === "fail" && "text-red-500",
              okTone === "muted" && "text-muted-foreground",
            )}
            aria-hidden="true"
          />
          {stripBody}
        </div>
        <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          {okPct != null ? (
            <span
              className={cn(
                "font-medium tabular-nums",
                okTone === "ok" && "text-emerald-600 dark:text-emerald-400",
                okTone === "warn" && "text-amber-600 dark:text-amber-400",
                okTone === "fail" && "text-red-600 dark:text-red-400",
              )}
            >
              {okCount}/{totalProbes} OK ({okPct}%)
            </span>
          ) : (
            <span>Chưa có dữ liệu kiểm tra</span>
          )}
          <span className="text-muted-foreground/70">
            <Sparkline probes={slots.filter((p): p is ProxyHealthProbe => p !== null)} />
          </span>
        </div>
      </div>
    </TooltipProvider>
  );
}
