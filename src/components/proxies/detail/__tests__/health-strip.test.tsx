import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HealthStrip, type ProxyHealthProbe } from "../health-strip";

/**
 * Wave 26-D-pre1 — pin the strip's behaviours that user-visibly matter:
 *   - Pads to 20 slots with grays when probes < 20
 *   - Renders OK count / pct in the right tone bucket
 *   - Empty state copy
 *   - onClick wiring (keyboard + mouse)
 */

function probe(checked_at: string, ok: boolean, speed_ms: number | null = null, error?: string): ProxyHealthProbe {
  return { checked_at, ok, speed_ms, error_msg: error ?? null };
}

describe("HealthStrip", () => {
  it("renders empty state when no probes exist", () => {
    render(<HealthStrip probes={[]} />);
    expect(screen.getByText("Chưa có dữ liệu kiểm tra")).toBeDefined();
  });

  it("pads to exactly 20 slots when probes < 20", () => {
    render(<HealthStrip probes={[probe("2026-05-01T10:00:00Z", true, 100)]} />);
    // 19 padding + 1 probe = 20 li elements
    const items = document.querySelectorAll("li");
    expect(items.length).toBe(20);
  });

  it("uses up to 20 most recent probes when given more", () => {
    const probes = Array.from({ length: 30 }, (_, i) =>
      probe(`2026-05-01T${String(i % 24).padStart(2, "0")}:00:00Z`, true, 100 + i),
    );
    render(<HealthStrip probes={probes} />);
    expect(document.querySelectorAll("li").length).toBe(20);
  });

  it("computes OK count + percentage", () => {
    const probes: ProxyHealthProbe[] = [
      probe("2026-05-01T10:00:00Z", true, 100),
      probe("2026-05-01T11:00:00Z", true, 100),
      probe("2026-05-01T12:00:00Z", false, null, "timeout"),
      probe("2026-05-01T13:00:00Z", true, 100),
    ];
    render(<HealthStrip probes={probes} />);
    expect(screen.getByText(/3\/4 OK \(75%\)/)).toBeDefined();
  });

  it("renders 100% when all probes pass", () => {
    const probes: ProxyHealthProbe[] = [
      probe("2026-05-01T10:00:00Z", true, 100),
      probe("2026-05-01T11:00:00Z", true, 120),
    ];
    render(<HealthStrip probes={probes} />);
    expect(screen.getByText(/2\/2 OK \(100%\)/)).toBeDefined();
  });

  it("invokes onClick when the strip is clicked (keyboard + mouse)", () => {
    const onClick = vi.fn();
    render(<HealthStrip probes={[probe("2026-05-01T10:00Z", true, 100)]} onClick={onClick} />);
    const button = screen.getByRole("button", { name: /Mở lịch sử kiểm tra/ });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(button, { key: "Enter" });
    expect(onClick).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(button, { key: " " });
    expect(onClick).toHaveBeenCalledTimes(3);

    fireEvent.keyDown(button, { key: "a" });
    expect(onClick).toHaveBeenCalledTimes(3); // unchanged on non-activation key
  });

  it("does not render the click affordance when onClick is missing", () => {
    render(<HealthStrip probes={[probe("2026-05-01T10:00Z", true, 100)]} />);
    expect(screen.queryByRole("button", { name: /Mở lịch sử kiểm tra/ })).toBeNull();
  });

  it("compact mode hides the count + sparkline", () => {
    render(
      <HealthStrip
        probes={[probe("2026-05-01T10:00Z", true, 100)]}
        compact
      />,
    );
    expect(screen.queryByText(/OK \(/)).toBeNull();
    expect(screen.queryByText("Chưa có dữ liệu kiểm tra")).toBeNull();
  });
});
