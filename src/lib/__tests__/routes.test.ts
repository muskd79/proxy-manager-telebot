import { describe, it, expect } from "vitest";
import {
  routes,
  proxiesRoute,
  proxyDetailRoute,
  usersRoute,
  userDetailRoute,
  requestsRoute,
  historyRoute,
  dashboardRoute,
} from "../routes";

/**
 * Wave 25-pre2 (Pass 7.D) — pin URL builder output. If a future
 * refactor moves `/proxies` under `/admin/proxies` the failing
 * tests here force the dev to update every call site, not just
 * the one they happened to look at.
 */
describe("routes builders", () => {
  it("dashboardRoute returns bare /dashboard", () => {
    expect(dashboardRoute()).toBe("/dashboard");
    expect(routes.dashboard()).toBe("/dashboard");
  });

  it("historyRoute returns bare /history", () => {
    expect(historyRoute()).toBe("/history");
  });

  describe("proxiesRoute", () => {
    it("bare returns /proxies", () => {
      expect(proxiesRoute()).toBe("/proxies");
    });

    it("with status filter", () => {
      expect(proxiesRoute({ status: "available" })).toBe(
        "/proxies?status=available",
      );
    });

    it("with multiple params", () => {
      const url = proxiesRoute({ status: "assigned", type: "http" });
      // URLSearchParams keeps insertion order; we only assert both keys are present.
      expect(url).toContain("/proxies?");
      expect(url).toContain("status=assigned");
      expect(url).toContain("type=http");
    });

    it("drops null/undefined/empty params", () => {
      expect(proxiesRoute({ status: undefined, type: undefined })).toBe("/proxies");
      expect(proxiesRoute({ status: "available", q: "" })).toBe(
        "/proxies?status=available",
      );
    });

    it("encodes special chars in q", () => {
      const url = proxiesRoute({ q: "host name & port" });
      expect(url).toContain("q=host+name+%26+port");
    });
  });

  describe("usersRoute", () => {
    it("bare returns /users", () => {
      expect(usersRoute()).toBe("/users");
    });

    it("status=pending", () => {
      expect(usersRoute({ status: "pending" })).toBe("/users?status=pending");
    });
  });

  describe("requestsRoute", () => {
    it("bare returns /requests", () => {
      expect(requestsRoute()).toBe("/requests");
    });

    it("status=pending", () => {
      expect(requestsRoute({ status: "pending" })).toBe(
        "/requests?status=pending",
      );
    });
  });

  describe("detail routes", () => {
    it("proxyDetailRoute encodes id", () => {
      expect(proxyDetailRoute("abc-123")).toBe("/proxies/abc-123");
      expect(proxyDetailRoute("a/b")).toBe("/proxies/a%2Fb");
    });

    it("userDetailRoute encodes id", () => {
      expect(userDetailRoute("u-1")).toBe("/users/u-1");
    });
  });

  describe("namespaced routes object", () => {
    it("exposes every builder under the same name", () => {
      expect(routes.proxies({ status: "expired" })).toBe(
        "/proxies?status=expired",
      );
      expect(routes.users({ status: "blocked" })).toBe("/users?status=blocked");
      expect(routes.requests({ status: "approved" })).toBe(
        "/requests?status=approved",
      );
      expect(routes.history()).toBe("/history");
      expect(routes.proxyDetail("p-1")).toBe("/proxies/p-1");
      expect(routes.userDetail("u-1")).toBe("/users/u-1");
    });
  });
});
