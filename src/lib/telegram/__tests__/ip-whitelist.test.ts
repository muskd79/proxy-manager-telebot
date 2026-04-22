import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isTelegramIp } from "../ip-whitelist";

describe("isTelegramIp", () => {
  const originalBypass = process.env.SKIP_TELEGRAM_IP_CHECK;

  beforeEach(() => {
    delete process.env.SKIP_TELEGRAM_IP_CHECK;
  });

  afterEach(() => {
    if (originalBypass !== undefined) {
      process.env.SKIP_TELEGRAM_IP_CHECK = originalBypass;
    }
  });

  describe("149.154.160.0/20 range", () => {
    it("allows network boundary", () => {
      expect(isTelegramIp("149.154.160.0")).toBe(true);
    });

    it("allows middle of range", () => {
      expect(isTelegramIp("149.154.165.100")).toBe(true);
    });

    it("allows upper boundary", () => {
      expect(isTelegramIp("149.154.175.255")).toBe(true);
    });

    it("rejects just outside upper boundary", () => {
      expect(isTelegramIp("149.154.176.0")).toBe(false);
    });

    it("rejects just outside lower boundary", () => {
      expect(isTelegramIp("149.154.159.255")).toBe(false);
    });
  });

  describe("91.108.4.0/22 range", () => {
    it("allows network boundary", () => {
      expect(isTelegramIp("91.108.4.0")).toBe(true);
    });

    it("allows middle of range", () => {
      expect(isTelegramIp("91.108.5.42")).toBe(true);
    });

    it("allows upper boundary", () => {
      expect(isTelegramIp("91.108.7.255")).toBe(true);
    });

    it("rejects just outside upper boundary", () => {
      expect(isTelegramIp("91.108.8.0")).toBe(false);
    });
  });

  describe("invalid / edge cases", () => {
    it("rejects empty string", () => {
      expect(isTelegramIp("")).toBe(false);
    });

    it("rejects 'unknown'", () => {
      expect(isTelegramIp("unknown")).toBe(false);
    });

    it("rejects IPv6 address", () => {
      expect(isTelegramIp("2001:db8::1")).toBe(false);
    });

    it("rejects malformed IPv4 (too few octets)", () => {
      expect(isTelegramIp("1.2.3")).toBe(false);
    });

    it("rejects malformed IPv4 (out-of-range octet)", () => {
      expect(isTelegramIp("1.2.3.256")).toBe(false);
    });

    it("rejects leading-zero octets (prevents injection via 010 etc.)", () => {
      expect(isTelegramIp("149.154.160.01")).toBe(false);
    });

    it("strips IPv4-mapped IPv6 prefix", () => {
      expect(isTelegramIp("::ffff:149.154.160.5")).toBe(true);
    });

    it("rejects public non-Telegram IP", () => {
      expect(isTelegramIp("8.8.8.8")).toBe(false);
    });
  });

  describe("emergency bypass", () => {
    it("allows any ip when SKIP_TELEGRAM_IP_CHECK=true", () => {
      process.env.SKIP_TELEGRAM_IP_CHECK = "true";
      expect(isTelegramIp("8.8.8.8")).toBe(true);
      expect(isTelegramIp("unknown")).toBe(true);
    });

    it("does not bypass for SKIP_TELEGRAM_IP_CHECK=false", () => {
      process.env.SKIP_TELEGRAM_IP_CHECK = "false";
      expect(isTelegramIp("8.8.8.8")).toBe(false);
    });
  });
});
