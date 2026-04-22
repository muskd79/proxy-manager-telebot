import { describe, it, expect, vi, beforeEach } from "vitest";
import { validatePublicHostLiteral, SsrfBlockedError } from "../public-ip";

// Mock dns.promises for assertPublicHost tests.
vi.mock("dns", () => ({
  default: {
    promises: {
      resolve4: vi.fn(),
      resolve6: vi.fn(),
    },
  },
  promises: {
    resolve4: vi.fn(),
    resolve6: vi.fn(),
  },
}));

import dns from "dns";
import { assertPublicHost } from "../public-ip";

describe("validatePublicHostLiteral — fast-path Zod refinement", () => {
  it("accepts public IPv4", () => {
    expect(validatePublicHostLiteral("8.8.8.8")).toBeNull();
    expect(validatePublicHostLiteral("203.0.113.5")).toBeNull();
  });

  it("rejects loopback 127/8", () => {
    expect(validatePublicHostLiteral("127.0.0.1")).toMatch(/loopback/);
    expect(validatePublicHostLiteral("127.1.2.3")).toMatch(/loopback/);
  });

  it("rejects AWS metadata link-local", () => {
    expect(validatePublicHostLiteral("169.254.169.254")).toMatch(/link-local/);
  });

  it("rejects RFC1918 private ranges", () => {
    expect(validatePublicHostLiteral("10.0.0.1")).toMatch(/private/);
    expect(validatePublicHostLiteral("172.16.5.1")).toMatch(/private/);
    expect(validatePublicHostLiteral("192.168.1.1")).toMatch(/private/);
  });

  it("rejects decimal-encoded loopback (2130706433 = 127.0.0.1)", () => {
    expect(validatePublicHostLiteral("2130706433")).toMatch(/loopback/);
  });

  it("rejects hex-encoded loopback (0x7f000001)", () => {
    expect(validatePublicHostLiteral("0x7f000001")).toMatch(/loopback/);
  });

  it("rejects IPv6 loopback (via blocked name shortlist fast-path)", () => {
    // ::1 and [::1] hit the BLOCKED_NAMES set before the CIDR check,
    // so the reason is "blocked name" not "loopback" — either is fine,
    // both mean rejected.
    expect(validatePublicHostLiteral("::1")).toBeTruthy();
    expect(validatePublicHostLiteral("[::1]")).toBeTruthy();
  });

  it("rejects IPv4-mapped IPv6 for private addresses", () => {
    expect(validatePublicHostLiteral("::ffff:10.0.0.1")).toMatch(/IPv4-mapped/);
  });

  it("rejects blocked name shortlist", () => {
    expect(validatePublicHostLiteral("localhost")).toMatch(/blocked name/);
    expect(validatePublicHostLiteral("0.0.0.0")).toBeTruthy();
  });

  it("passes valid hostnames (refinement only rejects literals)", () => {
    expect(validatePublicHostLiteral("example.com")).toBeNull();
    expect(validatePublicHostLiteral("proxy.acme.co")).toBeNull();
  });

  it("rejects empty host", () => {
    expect(validatePublicHostLiteral("")).toBe("empty host");
  });
});

describe("assertPublicHost — full async check with DNS", () => {
  beforeEach(() => {
    vi.mocked(dns.promises.resolve4).mockReset();
    vi.mocked(dns.promises.resolve6).mockReset();
  });

  it("returns IP for public literal IPv4", async () => {
    const result = await assertPublicHost("8.8.8.8");
    expect(result).toBe("8.8.8.8");
  });

  it("throws SsrfBlockedError for loopback literal", async () => {
    await expect(assertPublicHost("127.0.0.1")).rejects.toThrow(SsrfBlockedError);
  });

  it("throws for decimal-encoded loopback", async () => {
    await expect(assertPublicHost("2130706433")).rejects.toThrow(SsrfBlockedError);
  });

  it("throws for AWS metadata IP", async () => {
    await expect(assertPublicHost("169.254.169.254")).rejects.toThrow(SsrfBlockedError);
  });

  it("resolves public hostname and returns first A record", async () => {
    vi.mocked(dns.promises.resolve4).mockResolvedValue(["93.184.216.34"]);
    vi.mocked(dns.promises.resolve6).mockRejectedValue(new Error("no AAAA"));
    const result = await assertPublicHost("example.com");
    expect(result).toBe("93.184.216.34");
  });

  it("blocks DNS-rebinding: hostname resolves to one private IP -> reject", async () => {
    vi.mocked(dns.promises.resolve4).mockResolvedValue(["1.2.3.4", "10.0.0.5"]);
    vi.mocked(dns.promises.resolve6).mockRejectedValue(new Error("no AAAA"));
    await expect(assertPublicHost("evil.example.com")).rejects.toThrow(SsrfBlockedError);
    await expect(assertPublicHost("evil.example.com")).rejects.toThrow(/10\.0\.0\.5/);
  });

  it("throws when hostname has no DNS records", async () => {
    vi.mocked(dns.promises.resolve4).mockResolvedValue([]);
    vi.mocked(dns.promises.resolve6).mockResolvedValue([]);
    await expect(assertPublicHost("nx.example.com")).rejects.toThrow(/no DNS records/);
  });

  it("throws for localhost name without hitting DNS", async () => {
    await expect(assertPublicHost("localhost")).rejects.toThrow(/blocked name/);
    expect(vi.mocked(dns.promises.resolve4)).not.toHaveBeenCalled();
  });

  it("returns IPv6 when only AAAA records exist", async () => {
    vi.mocked(dns.promises.resolve4).mockResolvedValue([]);
    vi.mocked(dns.promises.resolve6).mockResolvedValue(["2606:4700:4700::1111"]);
    const result = await assertPublicHost("ipv6-only.example.com");
    expect(result).toBe("2606:4700:4700::1111");
  });

  it("blocks ambiguous numeric literal (octal with dots)", async () => {
    // 0177.0.0.1 is NOT a standard dotted-quad; we block conservatively.
    await expect(assertPublicHost("0177.0.0.1")).rejects.toThrow(SsrfBlockedError);
  });
});
