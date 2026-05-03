import { describe, it, expect } from "vitest";
import {
  mapRequestToEvents,
  mapActivityLogToEvent,
  mapRequestsToEvents,
  mapActivityLogsToEvents,
  mergeAndSortEvents,
} from "../event-mappers";
import type { ProxyRequest, ActivityLog } from "@/types/database";

/**
 * Wave 26-D-pre1 — pin every branch of the timeline event mapper.
 *
 * The mappers are pure functions glueing the legacy /api/requests +
 * /api/logs endpoints into a unified TimelineEvent[] until Wave 26-D
 * ships proxy_events. Tests below assert:
 *   - Each ProxyRequest status produces the right event_type pair
 *   - rejected_reason flows into the summary
 *   - Each ActivityLog action maps to the right kind / summary
 *   - Unknown actions return null (timeline filters them out)
 *   - mergeAndSortEvents sorts newest-first AND stable on ties
 */

const baseRequest: ProxyRequest = {
  id: "req-1",
  tele_user_id: "11111111-1111-1111-1111-111111111111",
  proxy_id: "22222222-2222-2222-2222-222222222222",
  proxy_type: "http",
  country: "VN",
  status: "pending",
  approval_mode: "auto",
  approved_by: null,
  rejected_reason: null,
  requested_at: "2026-05-01T10:00:00.000Z",
  processed_at: null,
  expires_at: null,
  quantity: 1,
  batch_id: null,
  is_deleted: false,
  deleted_at: null,
  created_at: "2026-05-01T10:00:00.000Z",
};

describe("mapRequestToEvents", () => {
  it("emits request_created on requested_at, even for pending", () => {
    const events = mapRequestToEvents({ ...baseRequest });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("request_created");
    expect(events[0].at).toBe("2026-05-01T10:00:00.000Z");
    expect(events[0].summary).toContain("HTTP");
    expect(events[0].summary).toContain("VN");
    expect(events[0].cta?.href).toContain("/requests?id=req-1");
  });

  it("emits request_approved at processed_at when admin approved", () => {
    const events = mapRequestToEvents({
      ...baseRequest,
      status: "approved",
      approved_by: "33333333-3333-3333-3333-333333333333",
      processed_at: "2026-05-01T10:30:00.000Z",
    });
    expect(events).toHaveLength(2);
    expect(events[1].kind).toBe("request_approved");
    expect(events[1].actorLabel).toMatch(/^Admin /);
    expect(events[1].actorHref).toBe(
      "/admins/33333333-3333-3333-3333-333333333333",
    );
  });

  it("emits request_auto_approved with actorLabel='Tự động'", () => {
    const events = mapRequestToEvents({
      ...baseRequest,
      status: "auto_approved",
      approval_mode: "auto",
      processed_at: "2026-05-01T10:00:05.000Z",
    });
    expect(events).toHaveLength(2);
    expect(events[1].kind).toBe("request_auto_approved");
    expect(events[1].actorLabel).toBe("Tự động");
    expect(events[1].actorHref).toBeNull();
  });

  it("includes rejected_reason in the summary for rejected requests", () => {
    const events = mapRequestToEvents({
      ...baseRequest,
      status: "rejected",
      rejected_reason: "Hết stock VN",
      processed_at: "2026-05-01T11:00:00.000Z",
    });
    expect(events).toHaveLength(2);
    expect(events[1].summary).toContain("Hết stock VN");
  });

  it("expired requests emit request_expired event", () => {
    const events = mapRequestToEvents({
      ...baseRequest,
      status: "expired",
      processed_at: "2026-05-01T12:00:00.000Z",
    });
    expect(events).toHaveLength(2);
    expect(events[1].kind).toBe("request_expired");
  });

  it("cancelled / pending → only request_created (no terminal event)", () => {
    expect(mapRequestToEvents({ ...baseRequest, status: "cancelled" })).toHaveLength(1);
    expect(mapRequestToEvents({ ...baseRequest, status: "pending" })).toHaveLength(1);
  });
});

const baseLog: ActivityLog = {
  id: "log-1",
  actor_type: "admin",
  actor_id: "44444444-4444-4444-4444-444444444444",
  actor_display_name: "alice",
  action: "proxy.create",
  resource_type: "proxy",
  resource_id: "22222222-2222-2222-2222-222222222222",
  details: null,
  ip_address: null,
  user_agent: null,
  created_at: "2026-05-01T09:00:00.000Z",
};

describe("mapActivityLogToEvent", () => {
  it("maps proxy.create to kind='created'", () => {
    const e = mapActivityLogToEvent({ ...baseLog, action: "proxy.create" });
    expect(e?.kind).toBe("created");
    expect(e?.summary).toMatch(/được tạo/i);
    expect(e?.actorLabel).toBe("alice");
    expect(e?.actorHref).toBe("/admins/44444444-4444-4444-4444-444444444444");
  });

  it("maps proxy.import to kind='imported' with batch CTA", () => {
    const e = mapActivityLogToEvent({
      ...baseLog,
      action: "proxy.import",
      details: { importId: "55555555-5555-5555-5555-555555555555" },
    });
    expect(e?.kind).toBe("imported");
    expect(e?.cta?.href).toContain("import_batch_id=55555555");
  });

  it("maps proxy.import without importId → no CTA", () => {
    const e = mapActivityLogToEvent({
      ...baseLog,
      action: "proxy.import",
      details: {},
    });
    expect(e?.kind).toBe("imported");
    expect(e?.cta).toBeNull();
  });

  it("maps proxy.update to kind='edited' with field list", () => {
    const e = mapActivityLogToEvent({
      ...baseLog,
      action: "proxy.update",
      details: { fields: ["status", "country"] },
    });
    expect(e?.kind).toBe("edited");
    expect(e?.summary).toContain("status");
    expect(e?.summary).toContain("country");
  });

  it("maps proxy.bulk_edit to kind='bulk_edited'", () => {
    const e = mapActivityLogToEvent({
      ...baseLog,
      action: "proxy.bulk_edit",
      details: { fields: ["category_id"] },
    });
    expect(e?.kind).toBe("bulk_edited");
    expect(e?.summary).toMatch(/Sửa hàng loạt/);
  });

  it("maps proxy.delete to kind='soft_deleted'", () => {
    const e = mapActivityLogToEvent({
      ...baseLog,
      action: "proxy.delete",
    });
    expect(e?.kind).toBe("soft_deleted");
    expect(e?.summary).toMatch(/thùng rác/);
  });

  it("maps proxy_auto_assigned with tele_user_id link", () => {
    const e = mapActivityLogToEvent({
      ...baseLog,
      action: "proxy_auto_assigned",
      actor_type: "bot",
      actor_id: null,
      actor_display_name: null,
      details: { tele_user_id: "66666666-6666-6666-6666-666666666666" },
    });
    expect(e?.kind).toBe("assigned");
    expect(e?.summary).toContain("66666666");
    expect(e?.cta?.href).toContain("/users/66666666");
    expect(e?.actorLabel).toBe("Bot Telegram");
  });

  it("maps proxy_revoked with reason in summary", () => {
    const e = mapActivityLogToEvent({
      ...baseLog,
      action: "proxy_revoked",
      details: { reason: "user-return" },
    });
    expect(e?.kind).toBe("unassigned");
    expect(e?.summary).toContain("user-return");
  });

  it("returns null for proxy_revoke_failed (don't surface errors)", () => {
    const e = mapActivityLogToEvent({
      ...baseLog,
      action: "proxy_revoke_failed",
    });
    expect(e).toBeNull();
  });

  it("returns null for unknown actions", () => {
    expect(mapActivityLogToEvent({ ...baseLog, action: "weird.action" })).toBeNull();
  });

  it("falls back to actor_type when actor_display_name is null", () => {
    const e = mapActivityLogToEvent({
      ...baseLog,
      actor_display_name: null,
      actor_type: "system",
      actor_id: null,
    });
    expect(e?.actorLabel).toBe("Hệ thống");
  });
});

describe("mapRequestsToEvents (array)", () => {
  it("flattens multiple requests into a flat event array", () => {
    const events = mapRequestsToEvents([
      { ...baseRequest, id: "r1", status: "pending" },
      {
        ...baseRequest,
        id: "r2",
        status: "approved",
        approved_by: "admin-a",
        processed_at: "2026-05-01T10:30:00.000Z",
      },
    ]);
    // 1 created (pending) + 2 events for approved (created + approved) = 3
    expect(events).toHaveLength(3);
  });
});

describe("mapActivityLogsToEvents (array)", () => {
  it("filters out unknown actions", () => {
    const events = mapActivityLogsToEvents([
      { ...baseLog, id: "1", action: "proxy.create" },
      { ...baseLog, id: "2", action: "weird.action" },
      { ...baseLog, id: "3", action: "proxy.delete" },
    ]);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.kind)).toEqual(["created", "soft_deleted"]);
  });
});

describe("mergeAndSortEvents", () => {
  it("sorts newest-first by `at` timestamp", () => {
    const events = mergeAndSortEvents(
      [
        {
          id: "a",
          kind: "created",
          at: "2026-05-01T08:00:00.000Z",
          actorLabel: null,
          summary: "old",
        },
      ],
      [
        {
          id: "b",
          kind: "edited",
          at: "2026-05-01T10:00:00.000Z",
          actorLabel: null,
          summary: "newer",
        },
      ],
    );
    expect(events.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("stable on equal timestamps (preserves input order)", () => {
    const events = mergeAndSortEvents(
      [
        { id: "1", kind: "created", at: "2026-05-01T10:00:00.000Z", actorLabel: null, summary: "first" },
        { id: "2", kind: "edited", at: "2026-05-01T10:00:00.000Z", actorLabel: null, summary: "second" },
      ],
      [
        { id: "3", kind: "soft_deleted", at: "2026-05-01T10:00:00.000Z", actorLabel: null, summary: "third" },
      ],
    );
    expect(events.map((e) => e.id)).toEqual(["1", "2", "3"]);
  });

  it("returns empty array when no events", () => {
    expect(mergeAndSortEvents([], [])).toEqual([]);
  });
});
