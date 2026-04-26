import { describe, it, expect } from "vitest";
import { countryFromIp } from "../country-from-ip";

describe("countryFromIp", () => {
  it("returns VN for known Vietnam VNNIC blocks", () => {
    expect(countryFromIp("14.165.32.1")).toBe("VN");
    expect(countryFromIp("27.72.1.1")).toBe("VN");
    expect(countryFromIp("113.160.5.10")).toBe("VN");
    expect(countryFromIp("125.234.5.5")).toBe("VN");
  });

  it("returns US for known US-dominant blocks", () => {
    expect(countryFromIp("8.8.8.8")).toBe("US");
    expect(countryFromIp("17.1.1.1")).toBe("US");
    expect(countryFromIp("64.10.10.10")).toBe("US");
  });

  it("returns EU for RIPE blocks", () => {
    expect(countryFromIp("46.1.1.1")).toBe("EU");
    expect(countryFromIp("85.1.1.1")).toBe("EU");
    expect(countryFromIp("190.1.1.1")).toBe("EU"); // covered by 188..195 hint
  });

  it("returns null for blocks outside any hint", () => {
    expect(countryFromIp("100.1.1.1")).toBe(null); // 100 not in any hint range
    expect(countryFromIp("160.1.1.1")).toBe(null);
  });

  it("returns null for unknown blocks", () => {
    expect(countryFromIp("203.0.113.1")).toBe(null); // TEST-NET-3
    expect(countryFromIp("198.51.100.1")).toBe(null); // TEST-NET-2
  });

  it("returns null for hostnames", () => {
    expect(countryFromIp("example.com")).toBe(null);
    expect(countryFromIp("proxy.acme.co")).toBe(null);
  });

  it("returns null for malformed input", () => {
    expect(countryFromIp("")).toBe(null);
    expect(countryFromIp("not an ip")).toBe(null);
    expect(countryFromIp("1.2.3")).toBe(null);
    expect(countryFromIp("1.2.3.999")).toBe(null);
    expect(countryFromIp("0.1.2.3")).toBe(null); // first octet 0 = invalid public
    expect(countryFromIp("224.0.0.1")).toBe(null); // multicast
  });

  it("ignores upper octets — only first octet is used as RIR hint", () => {
    expect(countryFromIp("8.0.0.0")).toBe("US");
    expect(countryFromIp("8.255.255.255")).toBe("US");
  });
});
