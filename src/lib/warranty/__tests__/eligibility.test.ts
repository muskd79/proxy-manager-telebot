import { describe, it, expect } from "vitest";
import {
  checkWarrantyEligibility,
  DEFAULT_WARRANTY_SETTINGS,
  WARRANTY_REJECT_LABEL_VI,
} from "../eligibility";
import type { Proxy, WarrantyClaim } from "@/types/database";
import { ProxyStatus } from "@/types/database";
// Wave 28 — sentinel category for proxies in test fixtures (mig 068).
import { DEFAULT_CATEGORY_ID } from "@/lib/categories/constants";

/**
 * Wave 26-D — pin every reject path of the warranty eligibility gate.
 *
 * Order of checks matters for UX (most user-meaningful first); each
 * test forces a specific condition while keeping all others passing,
 * so we know exactly which branch triggered.
 */

const NOW = new Date("2026-05-04T12:00:00Z");
const USER_ID = "11111111-1111-1111-1111-111111111111";
const PROXY_ID = "22222222-2222-2222-2222-222222222222";

function buildProxy(overrides: Partial<Proxy> = {}): Proxy {
  return {
    id: PROXY_ID,
    host: "1.2.3.4",
    port: 8080,
    type: "http",
    category_id: DEFAULT_CATEGORY_ID,
    username: "user",
    password: "pass",
    country: "VN",
    city: null,
    isp: null,
    status: ProxyStatus.Assigned,
    speed_ms: 100,
    last_checked_at: NOW.toISOString(),
    assigned_to: USER_ID,
    // 1 hour ago — well within 24h window
    assigned_at: new Date(NOW.getTime() - 1 * 60 * 60 * 1000).toISOString(),
    expires_at: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    network_type: "datacenter_ipv4",
    sale_price_usd: null,
    hidden: false,
    notes: null,
    is_deleted: false,
    deleted_at: null,
    created_by: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    purchase_date: null,
    vendor_label: null,
    cost_usd: null,
    geo_country_iso: null,
    distribute_count: 1,
    last_distributed_at: NOW.toISOString(),
    ...overrides,
  };
}

function claim(
  status: WarrantyClaim["status"] = "pending",
  ago_min = 0,
  proxy_id = "11pp-other-proxy",
): Pick<WarrantyClaim, "id" | "proxy_id" | "status" | "created_at"> {
  return {
    id: `claim-${Math.random().toString(36).slice(2)}`,
    proxy_id,
    status,
    created_at: new Date(NOW.getTime() - ago_min * 60_000).toISOString(),
  };
}

describe("checkWarrantyEligibility — happy path", () => {
  it("allows when all checks pass", () => {
    const r = checkWarrantyEligibility({
      proxy: buildProxy(),
      userId: USER_ID,
      userClaims: [],
      now: NOW,
    });
    expect(r).toEqual({ allowed: true });
  });
});

describe("checkWarrantyEligibility — proxy ownership / status", () => {
  it("rejects when proxy assigned to different user", () => {
    const r = checkWarrantyEligibility({
      proxy: buildProxy({ assigned_to: "other-user-id" }),
      userId: USER_ID,
      userClaims: [],
      now: NOW,
    });
    expect(r).toMatchObject({
      allowed: false,
      code: "proxy_not_assigned_to_user",
    });
  });

  it("rejects when proxy.status is not 'assigned'", () => {
    const cases: ProxyStatus[] = [
      ProxyStatus.Available,
      ProxyStatus.Banned,
      ProxyStatus.Maintenance,
      ProxyStatus.Expired,
      ProxyStatus.ReportedBroken,
    ];
    for (const status of cases) {
      const r = checkWarrantyEligibility({
        proxy: buildProxy({ status }),
        userId: USER_ID,
        userClaims: [],
        now: NOW,
      });
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.code).toBe("proxy_status_invalid");
    }
  });
});

describe("checkWarrantyEligibility — eligibility window (A2)", () => {
  it("rejects when > 24h after assigned_at and unlimited=false", () => {
    const r = checkWarrantyEligibility({
      proxy: buildProxy({
        assigned_at: new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString(),
      }),
      userId: USER_ID,
      userClaims: [],
      now: NOW,
    });
    expect(r).toMatchObject({
      allowed: false,
      code: "outside_eligibility_window",
    });
  });

  it("allows when 23h59m after assigned_at and unlimited=false (boundary)", () => {
    const r = checkWarrantyEligibility({
      proxy: buildProxy({
        assigned_at: new Date(
          NOW.getTime() - (23 * 60 + 59) * 60 * 1000,
        ).toISOString(),
      }),
      userId: USER_ID,
      userClaims: [],
      now: NOW,
    });
    expect(r).toEqual({ allowed: true });
  });

  it("allows when > 24h after assigned_at and unlimited=true", () => {
    const r = checkWarrantyEligibility({
      proxy: buildProxy({
        assigned_at: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      userId: USER_ID,
      userClaims: [],
      settings: { eligibility_unlimited: true },
      now: NOW,
    });
    expect(r).toEqual({ allowed: true });
  });

  it("rejects when assigned_at is null and unlimited=false (defensive)", () => {
    const r = checkWarrantyEligibility({
      proxy: buildProxy({ assigned_at: null }),
      userId: USER_ID,
      userClaims: [],
      now: NOW,
    });
    expect(r).toMatchObject({
      allowed: false,
      code: "outside_eligibility_window",
    });
  });
});

describe("checkWarrantyEligibility — proxy expiry", () => {
  it("rejects when proxy.expires_at < now", () => {
    const r = checkWarrantyEligibility({
      proxy: buildProxy({
        expires_at: new Date(NOW.getTime() - 1000).toISOString(),
      }),
      userId: USER_ID,
      userClaims: [],
      now: NOW,
    });
    expect(r).toMatchObject({ allowed: false, code: "proxy_expired" });
  });

  it("allows when expires_at is null (lifetime proxy)", () => {
    const r = checkWarrantyEligibility({
      proxy: buildProxy({ expires_at: null }),
      userId: USER_ID,
      userClaims: [],
      now: NOW,
    });
    expect(r).toEqual({ allowed: true });
  });
});

describe("checkWarrantyEligibility — duplicate claim", () => {
  it("rejects when user has pending claim on the SAME proxy", () => {
    const r = checkWarrantyEligibility({
      proxy: buildProxy(),
      userId: USER_ID,
      userClaims: [claim("pending", 30, PROXY_ID)],
      now: NOW,
    });
    expect(r).toMatchObject({
      allowed: false,
      code: "duplicate_pending_claim",
    });
  });

  it("allows when user has rejected claim on same proxy (could re-claim)", () => {
    // Pre-cooldown clear: 70 min ago to bypass default 60min cooldown
    const r = checkWarrantyEligibility({
      proxy: buildProxy(),
      userId: USER_ID,
      userClaims: [claim("rejected", 70, PROXY_ID)],
      now: NOW,
    });
    expect(r).toEqual({ allowed: true });
  });
});

describe("checkWarrantyEligibility — anti-abuse caps (A3)", () => {
  it("rejects when pending claim count >= max_pending", () => {
    const r = checkWarrantyEligibility({
      proxy: buildProxy(),
      userId: USER_ID,
      // 2 pending claims on OTHER proxies → at default cap of 2
      userClaims: [
        claim("pending", 30, "other-1"),
        claim("pending", 60, "other-2"),
      ],
      now: NOW,
    });
    expect(r).toMatchObject({
      allowed: false,
      code: "max_pending_reached",
    });
  });

  it("rejects when 30d count >= max_per_30d", () => {
    const r = checkWarrantyEligibility({
      proxy: buildProxy(),
      userId: USER_ID,
      // 5 claims in last 29 days (rejected so they don't trip pending cap)
      // Spaced by 29h apart so cooldown clears.
      userClaims: [
        claim("rejected", 60 * 24 * 1, "p1"),
        claim("rejected", 60 * 24 * 5, "p2"),
        claim("rejected", 60 * 24 * 10, "p3"),
        claim("rejected", 60 * 24 * 20, "p4"),
        claim("rejected", 60 * 24 * 28, "p5"),
      ],
      now: NOW,
    });
    expect(r).toMatchObject({
      allowed: false,
      code: "max_per_30d_reached",
    });
  });

  it("rejects when last claim within cooldown window", () => {
    const r = checkWarrantyEligibility({
      proxy: buildProxy(),
      userId: USER_ID,
      userClaims: [
        // 30 minutes ago — default cooldown is 60min, still active
        claim("rejected", 30, "other-1"),
      ],
      now: NOW,
    });
    expect(r).toMatchObject({
      allowed: false,
      code: "cooldown_active",
    });
  });

  it("allows when last claim > cooldown ago", () => {
    const r = checkWarrantyEligibility({
      proxy: buildProxy(),
      userId: USER_ID,
      userClaims: [claim("rejected", 90, "other-1")],
      now: NOW,
    });
    expect(r).toEqual({ allowed: true });
  });

  it("respects custom settings overrides", () => {
    // 1 pending claim should reject when max_pending=1
    const r = checkWarrantyEligibility({
      proxy: buildProxy(),
      userId: USER_ID,
      userClaims: [claim("pending", 30, "other-1")],
      settings: { max_pending: 1 },
      now: NOW,
    });
    expect(r).toMatchObject({
      allowed: false,
      code: "max_pending_reached",
    });
  });
});

describe("WARRANTY_REJECT_LABEL_VI", () => {
  it("has Vietnamese label for every reject code", () => {
    const codes = [
      "proxy_not_assigned_to_user",
      "proxy_status_invalid",
      "outside_eligibility_window",
      "proxy_expired",
      "duplicate_pending_claim",
      "max_pending_reached",
      "max_per_30d_reached",
      "cooldown_active",
    ] as const;
    for (const c of codes) {
      expect(WARRANTY_REJECT_LABEL_VI[c]).toBeTruthy();
      expect(typeof WARRANTY_REJECT_LABEL_VI[c]).toBe("string");
    }
  });
});

describe("DEFAULT_WARRANTY_SETTINGS", () => {
  it("matches the 5 settings keys seeded by mig 057", () => {
    expect(DEFAULT_WARRANTY_SETTINGS).toEqual({
      eligibility_unlimited: false,
      max_pending: 2,
      max_per_30d: 5,
      cooldown_minutes: 60,
    });
  });
});
