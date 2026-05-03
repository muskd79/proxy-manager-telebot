import { describe, it, expect } from "vitest";
import { createMachine } from "../create-machine";
import { requestMachine, isTerminalRequestStatus } from "../request";
import { proxyMachine } from "../proxy";
import { RequestStatus, ProxyStatus } from "@/types/database";

describe("createMachine", () => {
  const traffic = createMachine<"red" | "yellow" | "green">({
    red: ["green"],
    green: ["yellow"],
    yellow: ["red"],
  });

  it("canTransition returns true for declared transitions", () => {
    expect(traffic.canTransition("red", "green")).toBe(true);
    expect(traffic.canTransition("green", "yellow")).toBe(true);
  });

  it("canTransition returns false for undeclared transitions", () => {
    expect(traffic.canTransition("red", "yellow")).toBe(false);
    expect(traffic.canTransition("green", "red")).toBe(false);
  });

  it("transition throws with context on invalid hop", () => {
    expect(() => traffic.transition("red", "yellow")).toThrowError(
      /Invalid state transition: red -> yellow/,
    );
  });

  it("transition returns the new state on valid hop", () => {
    expect(traffic.transition("red", "green")).toBe("green");
  });

  it("allowedFrom lists outgoing transitions", () => {
    expect(traffic.allowedFrom("red")).toEqual(["green"]);
  });
});

describe("requestMachine", () => {
  it("pending can reach every terminal status", () => {
    for (const to of [
      RequestStatus.Approved,
      RequestStatus.AutoApproved,
      RequestStatus.Rejected,
      RequestStatus.Expired,
      RequestStatus.Cancelled,
    ]) {
      expect(requestMachine.canTransition(RequestStatus.Pending, to)).toBe(true);
    }
  });

  it("terminal statuses cannot transition further", () => {
    for (const from of [
      RequestStatus.Approved,
      RequestStatus.AutoApproved,
      RequestStatus.Rejected,
      RequestStatus.Expired,
      RequestStatus.Cancelled,
    ]) {
      expect(isTerminalRequestStatus(from)).toBe(true);
      expect(requestMachine.allowedFrom(from)).toEqual([]);
    }
  });

  it("pending is not terminal", () => {
    expect(isTerminalRequestStatus(RequestStatus.Pending)).toBe(false);
  });

  it("blocks reviving a cancelled request back to pending", () => {
    expect(
      requestMachine.canTransition(RequestStatus.Cancelled, RequestStatus.Pending),
    ).toBe(false);
  });
});

describe("proxyMachine", () => {
  it("allows available <-> assigned", () => {
    expect(
      proxyMachine.canTransition(ProxyStatus.Available, ProxyStatus.Assigned),
    ).toBe(true);
    expect(
      proxyMachine.canTransition(ProxyStatus.Assigned, ProxyStatus.Available),
    ).toBe(true);
  });

  it("blocks banned -> available (must go through maintenance)", () => {
    expect(
      proxyMachine.canTransition(ProxyStatus.Banned, ProxyStatus.Available),
    ).toBe(false);
    expect(
      proxyMachine.canTransition(ProxyStatus.Banned, ProxyStatus.Maintenance),
    ).toBe(true);
    expect(
      proxyMachine.canTransition(ProxyStatus.Maintenance, ProxyStatus.Available),
    ).toBe(true);
  });

  it("allows assigned -> banned (ban report flow)", () => {
    expect(
      proxyMachine.canTransition(ProxyStatus.Assigned, ProxyStatus.Banned),
    ).toBe(true);
  });

  it("allows expired -> available (renew)", () => {
    expect(
      proxyMachine.canTransition(ProxyStatus.Expired, ProxyStatus.Available),
    ).toBe(true);
  });

  // ─── Wave 26-D — warranty transitions ────────────────────────────
  describe("Wave 26-D warranty mechanism", () => {
    it("allows assigned -> reported_broken (user báo lỗi qua bot)", () => {
      expect(
        proxyMachine.canTransition(ProxyStatus.Assigned, ProxyStatus.ReportedBroken),
      ).toBe(true);
    });

    it("allows reported_broken -> maintenance (admin duyệt warranty default)", () => {
      expect(
        proxyMachine.canTransition(
          ProxyStatus.ReportedBroken,
          ProxyStatus.Maintenance,
        ),
      ).toBe(true);
    });

    it("allows reported_broken -> banned (admin duyệt + checkbox 'mark banned')", () => {
      expect(
        proxyMachine.canTransition(
          ProxyStatus.ReportedBroken,
          ProxyStatus.Banned,
        ),
      ).toBe(true);
    });

    it("allows reported_broken -> assigned (admin từ chối warranty = revert)", () => {
      expect(
        proxyMachine.canTransition(
          ProxyStatus.ReportedBroken,
          ProxyStatus.Assigned,
        ),
      ).toBe(true);
    });

    it("blocks reported_broken -> available (must go through maintenance OR banned)", () => {
      expect(
        proxyMachine.canTransition(
          ProxyStatus.ReportedBroken,
          ProxyStatus.Available,
        ),
      ).toBe(false);
    });

    it("blocks reported_broken -> expired (cron expire path stays out of this branch)", () => {
      expect(
        proxyMachine.canTransition(
          ProxyStatus.ReportedBroken,
          ProxyStatus.Expired,
        ),
      ).toBe(false);
    });

    it("blocks available -> reported_broken (only assigned proxy can be reported)", () => {
      expect(
        proxyMachine.canTransition(
          ProxyStatus.Available,
          ProxyStatus.ReportedBroken,
        ),
      ).toBe(false);
    });

    it("blocks banned -> reported_broken (already terminal)", () => {
      expect(
        proxyMachine.canTransition(
          ProxyStatus.Banned,
          ProxyStatus.ReportedBroken,
        ),
      ).toBe(false);
    });
  });
});
