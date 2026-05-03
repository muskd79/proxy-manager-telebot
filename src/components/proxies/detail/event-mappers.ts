/**
 * Wave 26-D-pre1 — pure mappers from raw API rows → TimelineEvent.
 *
 * Wave 26-D itself replaces these with a single fetch from
 * /api/proxies/[id]/events (proxy_events table). For now, we glue
 * together two existing endpoints:
 *
 *   1. /api/requests?proxyId=…   → ProxyRequest rows
 *      Maps to: request_created / request_approved / request_rejected /
 *               request_auto_approved / request_expired
 *
 *   2. /api/logs?resourceType=proxy&resourceId=…  → ActivityLog rows
 *      Maps to: created / edited / bulk_edited / imported / soft_deleted /
 *               restored / assigned / unassigned
 *
 * Both endpoints return arrays in arbitrary order — the caller merges
 * the two TimelineEvent[] outputs, sorts by `at` descending, and passes
 * to <Timeline />.
 *
 * These mappers are pure + deterministic — vitest covers every branch.
 */

import type { ProxyRequest, ActivityLog, ProxyType } from "@/types/database";
import type { TimelineEvent } from "./timeline";

// Vietnamese labels for ProxyRequest statuses.
const REQUEST_STATUS_LABEL: Record<string, string> = {
  pending: "đang chờ duyệt",
  approved: "được duyệt",
  rejected: "bị từ chối",
  auto_approved: "được duyệt tự động",
  expired: "hết hạn chờ",
  cancelled: "bị huỷ",
};

const PROXY_TYPE_LABEL: Record<string, string> = {
  http: "HTTP",
  https: "HTTPS",
  socks5: "SOCKS5",
};

/**
 * One ProxyRequest row → up to 2 timeline events:
 *   - request_created at requested_at
 *   - one of: request_approved / request_rejected / request_auto_approved /
 *             request_expired at processed_at (if present)
 */
export function mapRequestToEvents(req: ProxyRequest): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // Best-effort actor labelling. The /api/requests payload doesn't
  // expose tele_user display name, so we render "user " + truncated id.
  const userActorLabel = req.tele_user_id
    ? `User ${req.tele_user_id.slice(0, 8)}…`
    : null;
  const userActorHref = req.tele_user_id ? `/users/${req.tele_user_id}` : null;
  const typeLabel = req.proxy_type ? PROXY_TYPE_LABEL[req.proxy_type as ProxyType] ?? req.proxy_type : null;
  const countrySuffix = req.country ? ` · ${req.country}` : "";

  // 1. request_created — always emitted.
  events.push({
    id: `req-${req.id}-created`,
    kind: "request_created",
    at: req.requested_at,
    actorLabel: userActorLabel,
    actorHref: userActorHref,
    summary: `Yêu cầu proxy${typeLabel ? ` ${typeLabel}` : ""}${countrySuffix}`,
    details: {
      proxy_type: req.proxy_type,
      country: req.country,
    },
    cta: { label: "Mở yêu cầu", href: `/requests?id=${req.id}` },
  });

  // 2. terminal event — only if processed_at exists (i.e., request was
  // resolved one way or another).
  if (req.processed_at) {
    let kind: TimelineEvent["kind"];
    switch (req.status) {
      case "approved":
        kind = "request_approved";
        break;
      case "auto_approved":
        kind = "request_auto_approved";
        break;
      case "rejected":
        kind = "request_rejected";
        break;
      case "expired":
        kind = "request_expired";
        break;
      default:
        // Cancelled / pending → no terminal event yet.
        return events;
    }

    const adminActorLabel = req.approved_by
      ? `Admin ${req.approved_by.slice(0, 8)}…`
      : null;
    const adminActorHref = req.approved_by ? `/admins/${req.approved_by}` : null;

    const summaryBase = `Yêu cầu ${REQUEST_STATUS_LABEL[req.status] ?? req.status}`;
    const summary = req.status === "rejected" && req.rejected_reason
      ? `${summaryBase} (lý do: ${req.rejected_reason})`
      : summaryBase;

    events.push({
      id: `req-${req.id}-${req.status}`,
      kind,
      at: req.processed_at,
      actorLabel: req.status === "auto_approved" ? "Tự động" : adminActorLabel,
      actorHref: req.status === "auto_approved" ? null : adminActorHref,
      summary,
      details: {
        approval_mode: req.approval_mode,
        rejected_reason: req.rejected_reason,
      },
    });
  }

  return events;
}

/**
 * One ActivityLog row → 0 or 1 timeline event. We skip rows with
 * actions we don't know how to render (the /logs page handles them).
 *
 * Action vocab (current sweep):
 *   - proxy.create / proxy.update / proxy.delete / proxy.bulk_edit / proxy.import
 *   - proxy_auto_assigned / proxy_revoked / proxy_revoke_failed (bot)
 *   - assign_proxy (legacy from mig 004 RPC)
 *
 * Wave 26-D will replace these heuristics with native proxy_events.event_type.
 */
export function mapActivityLogToEvent(log: ActivityLog): TimelineEvent | null {
  const actorLabel = log.actor_display_name
    ? log.actor_display_name
    : log.actor_id
      ? `${log.actor_type} ${log.actor_id.slice(0, 8)}…`
      : log.actor_type === "system"
        ? "Hệ thống"
        : log.actor_type === "bot"
          ? "Bot Telegram"
          : null;

  const actorHref =
    log.actor_id && log.actor_type === "admin"
      ? `/admins/${log.actor_id}`
      : log.actor_id && log.actor_type === "tele_user"
        ? `/users/${log.actor_id}`
        : null;

  const detailsObj = (log.details ?? {}) as Record<string, unknown>;

  switch (log.action) {
    case "proxy.create": {
      return {
        id: `log-${log.id}`,
        kind: "created",
        at: log.created_at,
        actorLabel,
        actorHref,
        summary: "Proxy được tạo",
        details: detailsObj,
      };
    }
    case "proxy.import": {
      const importId = typeof detailsObj.importId === "string" ? detailsObj.importId : null;
      return {
        id: `log-${log.id}`,
        kind: "imported",
        at: log.created_at,
        actorLabel,
        actorHref,
        summary: "Proxy được import từ batch",
        details: detailsObj,
        cta: importId
          ? { label: "Xem cả lô", href: `/proxies?import_batch_id=${importId}` }
          : null,
      };
    }
    case "proxy.update":
    case "proxy.bulk_edit": {
      // Best-effort — describe what changed if details has a `fields` array.
      const fields = Array.isArray(detailsObj.fields)
        ? (detailsObj.fields as unknown[]).map((f) => String(f))
        : [];
      const fieldList = fields.length > 0 ? ` (${fields.join(", ")})` : "";
      return {
        id: `log-${log.id}`,
        kind: log.action === "proxy.bulk_edit" ? "bulk_edited" : "edited",
        at: log.created_at,
        actorLabel,
        actorHref,
        summary:
          log.action === "proxy.bulk_edit"
            ? `Sửa hàng loạt${fieldList}`
            : `Sửa proxy${fieldList}`,
        details: detailsObj,
      };
    }
    case "proxy.delete": {
      // delete details may carry { is_deleted: true | false } when the
      // mig 037 soft-delete vs hard-delete branches are hit. We treat
      // any proxy.delete as soft_deleted for timeline purposes.
      const deletedAt = typeof detailsObj.deleted_at === "string" ? detailsObj.deleted_at : null;
      void deletedAt; // reserved for future copy
      return {
        id: `log-${log.id}`,
        kind: "soft_deleted",
        at: log.created_at,
        actorLabel,
        actorHref,
        summary: "Chuyển proxy vào thùng rác",
        details: detailsObj,
      };
    }
    case "proxy_auto_assigned":
    case "assign_proxy": {
      // Bot or RPC assignment. Try to surface the receiving user.
      const teleUserId =
        typeof detailsObj.tele_user_id === "string" ? detailsObj.tele_user_id : null;
      const userSuffix = teleUserId ? ` cho user ${teleUserId.slice(0, 8)}…` : "";
      return {
        id: `log-${log.id}`,
        kind: "assigned",
        at: log.created_at,
        actorLabel,
        actorHref,
        summary: `Proxy được giao${userSuffix}`,
        details: detailsObj,
        cta: teleUserId ? { label: "Xem user", href: `/users/${teleUserId}` } : null,
      };
    }
    case "proxy_revoked": {
      const reason = typeof detailsObj.reason === "string" ? detailsObj.reason : null;
      return {
        id: `log-${log.id}`,
        kind: "unassigned",
        at: log.created_at,
        actorLabel,
        actorHref,
        summary: reason ? `Thu hồi proxy (${reason})` : "Thu hồi proxy",
        details: detailsObj,
      };
    }
    case "proxy_revoke_failed": {
      // Don't surface failed revoke attempts in the user-facing timeline.
      // /logs page handles troubleshooting.
      return null;
    }
    default:
      return null;
  }
}

/**
 * Convenience wrapper — array versions of the two mappers.
 */
export function mapRequestsToEvents(requests: ProxyRequest[]): TimelineEvent[] {
  return requests.flatMap(mapRequestToEvents);
}

export function mapActivityLogsToEvents(logs: ActivityLog[]): TimelineEvent[] {
  const mapped: TimelineEvent[] = [];
  for (const log of logs) {
    const event = mapActivityLogToEvent(log);
    if (event) mapped.push(event);
  }
  return mapped;
}

/**
 * Merge two arrays of TimelineEvent and sort newest-first by `at`.
 * Stable sort: when timestamps are equal (rare — same insert tick) the
 * existing relative order is preserved, which keeps our deterministic
 * test fixtures readable.
 */
export function mergeAndSortEvents(...arrays: TimelineEvent[][]): TimelineEvent[] {
  const merged = arrays.flat();
  // We do an explicit stable sort: build [event, originalIndex] pairs.
  return merged
    .map((e, idx) => ({ e, idx }))
    .sort((a, b) => {
      const ta = new Date(a.e.at).getTime();
      const tb = new Date(b.e.at).getTime();
      if (tb !== ta) return tb - ta; // newest first
      return a.idx - b.idx;
    })
    .map(({ e }) => e);
}
