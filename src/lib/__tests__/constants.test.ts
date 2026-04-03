import { describe, it, expect } from "vitest";
import {
  PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  API_RATE_LIMIT_PER_MINUTE,
  HEALTH_CHECK_TIMEOUT_MS,
  HEALTH_CHECK_CONCURRENCY,
  IMPORT_BATCH_SIZE,
  TRASH_AUTO_CLEAN_DAYS,
  PROXY_TYPES,
  STATUS_COLORS,
} from "../constants";

describe("constants", () => {
  it("PAGE_SIZES has valid options", () => {
    expect(PAGE_SIZES).toContain(20);
    expect(PAGE_SIZES).toContain(50);
    expect(PAGE_SIZES).toContain(100);
    expect(PAGE_SIZES.length).toBeGreaterThanOrEqual(3);
  });

  it("DEFAULT_PAGE_SIZE is in PAGE_SIZES", () => {
    expect(PAGE_SIZES).toContain(DEFAULT_PAGE_SIZE);
  });

  it("rate limit is reasonable", () => {
    expect(API_RATE_LIMIT_PER_MINUTE).toBeGreaterThan(0);
    expect(API_RATE_LIMIT_PER_MINUTE).toBeLessThanOrEqual(1000);
  });

  it("health check timeout is reasonable", () => {
    expect(HEALTH_CHECK_TIMEOUT_MS).toBeGreaterThanOrEqual(5000);
    expect(HEALTH_CHECK_TIMEOUT_MS).toBeLessThanOrEqual(30000);
  });

  it("concurrency is reasonable", () => {
    expect(HEALTH_CHECK_CONCURRENCY).toBeGreaterThan(0);
    expect(HEALTH_CHECK_CONCURRENCY).toBeLessThanOrEqual(200);
  });

  it("import batch size is reasonable", () => {
    expect(IMPORT_BATCH_SIZE).toBeGreaterThan(0);
    expect(IMPORT_BATCH_SIZE).toBeLessThanOrEqual(1000);
  });

  it("trash auto-clean days is positive", () => {
    expect(TRASH_AUTO_CLEAN_DAYS).toBeGreaterThan(0);
  });

  it("PROXY_TYPES has all types", () => {
    expect(PROXY_TYPES).toContain("http");
    expect(PROXY_TYPES).toContain("https");
    expect(PROXY_TYPES).toContain("socks5");
  });

  it("STATUS_COLORS has all statuses", () => {
    expect(STATUS_COLORS).toHaveProperty("available");
    expect(STATUS_COLORS).toHaveProperty("assigned");
    expect(STATUS_COLORS).toHaveProperty("pending");
    expect(STATUS_COLORS).toHaveProperty("approved");
    expect(STATUS_COLORS).toHaveProperty("rejected");
  });
});
