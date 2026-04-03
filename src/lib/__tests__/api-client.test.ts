import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch and toast
global.fetch = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

import { apiClient } from "../api-client";

describe("apiClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success on 200 response", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { id: 1 } }),
    });

    const result = await apiClient("/api/test");
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 1 });
  });

  it("returns error on 400 response", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ success: false, error: "Bad request" }),
    });

    const result = await apiClient("/api/test", { showError: false });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Bad request");
  });

  it("handles network error", async () => {
    (global.fetch as any).mockRejectedValue(new Error("Network error"));

    const result = await apiClient("/api/test", { showError: false });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Network error");
  });
});
