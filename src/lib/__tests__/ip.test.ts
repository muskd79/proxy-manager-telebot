import { describe, it, expect } from "vitest";
import { getClientIp } from "../ip";

function mkReq(headers: Record<string, string>): Request {
  return new Request("http://localhost/", { headers });
}

describe("getClientIp", () => {
  it("prefers x-real-ip when present", () => {
    const req = mkReq({
      "x-real-ip": "149.154.160.5",
      "x-forwarded-for": "1.1.1.1, 2.2.2.2",
    });
    expect(getClientIp(req)).toBe("149.154.160.5");
  });

  it("falls back to x-forwarded-for last entry", () => {
    const req = mkReq({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" });
    expect(getClientIp(req)).toBe("3.3.3.3");
  });

  it("handles single-entry x-forwarded-for", () => {
    const req = mkReq({ "x-forwarded-for": "5.5.5.5" });
    expect(getClientIp(req)).toBe("5.5.5.5");
  });

  it("trims whitespace", () => {
    const req = mkReq({ "x-real-ip": "   10.0.0.1   " });
    expect(getClientIp(req)).toBe("10.0.0.1");
  });

  it("returns 'unknown' when no ip headers present", () => {
    const req = mkReq({});
    expect(getClientIp(req)).toBe("unknown");
  });
});
