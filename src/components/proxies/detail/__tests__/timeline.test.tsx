import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Timeline, type TimelineEvent } from "../timeline";

/**
 * Wave 26-D-pre1 — Timeline component tests.
 *
 * Covers:
 *   - Empty state copy when no events at all
 *   - Filter chips disable themselves when their bucket is empty
 *   - Active filter narrows the rendered list
 *   - "Reset to all" recovers from a filter that produced 0 matches
 *   - Loading + error states
 */

function ev(
  id: string,
  kind: TimelineEvent["kind"],
  at: string,
  summary = "test",
): TimelineEvent {
  return {
    id,
    kind,
    at,
    actorLabel: null,
    summary,
  };
}

describe("Timeline", () => {
  it("renders 'no activity' empty state when events is empty", () => {
    render(<Timeline events={[]} />);
    expect(screen.getByText(/chưa có hoạt động/i)).toBeDefined();
  });

  it("renders a row per event in the default 'Tất cả' filter", () => {
    const events: TimelineEvent[] = [
      ev("1", "created", "2026-05-01T10:00:00Z", "Proxy được tạo"),
      ev("2", "edited", "2026-05-01T11:00:00Z", "Sửa proxy"),
    ];
    render(<Timeline events={events} />);
    expect(screen.getByText("Proxy được tạo")).toBeDefined();
    expect(screen.getByText("Sửa proxy")).toBeDefined();
  });

  it("disables filter chips whose bucket has 0 events", () => {
    render(
      <Timeline
        events={[ev("1", "created", "2026-05-01T10:00:00Z")]}
      />,
    );
    // 'Yêu cầu', 'Giao / Thu hồi', 'Sửa', 'Bảo hành', 'Sức khỏe' all empty
    const requestChip = screen.getByRole("button", { name: /Yêu cầu/ }) as HTMLButtonElement;
    expect(requestChip.disabled).toBe(true);

    const systemChip = screen.getByRole("button", { name: /Hệ thống/ }) as HTMLButtonElement;
    expect(systemChip.disabled).toBe(false); // 'created' belongs here
  });

  it("filtering by 'Sửa' shows only edited events", () => {
    const events: TimelineEvent[] = [
      ev("1", "created", "2026-05-01T10:00:00Z", "tạo"),
      ev("2", "edited", "2026-05-01T11:00:00Z", "sửa lần 1"),
      ev("3", "bulk_edited", "2026-05-01T12:00:00Z", "bulk sửa"),
      ev("4", "assigned", "2026-05-01T13:00:00Z", "giao"),
    ];
    render(<Timeline events={events} />);

    const editChip = screen.getByRole("button", { name: /Sửa/ });
    fireEvent.click(editChip);
    expect(screen.getByText("sửa lần 1")).toBeDefined();
    expect(screen.getByText("bulk sửa")).toBeDefined();
    expect(screen.queryByText("tạo")).toBeNull();
    expect(screen.queryByText("giao")).toBeNull();
  });

  it("shows reset button when filter produces 0 matches and recovers on click", () => {
    // Edge case: filter chip is enabled before user removes data via
    // some external mutation. We simulate by clicking 'Sửa' on data
    // that DOES have an edit event, then re-rendering with no edits.
    const events1: TimelineEvent[] = [
      ev("1", "edited", "2026-05-01T11:00:00Z"),
    ];
    const { rerender } = render(<Timeline events={events1} />);
    fireEvent.click(screen.getByRole("button", { name: /Sửa/ }));

    // Drop the edit event — filter still active but bucket is empty.
    rerender(
      <Timeline
        events={[ev("2", "created", "2026-05-01T11:00:00Z")]}
      />,
    );
    expect(screen.getByText(/Không có sự kiện nào khớp/i)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Xem tất cả/ }));
    // After reset, the created event surfaces.
    expect(document.querySelector("li")).not.toBeNull();
  });

  it("shows loading skeletons when loading=true", () => {
    render(<Timeline events={[]} loading />);
    // 4 skeleton rows by component design
    const animateNodes = document.querySelectorAll(".animate-pulse");
    expect(animateNodes.length).toBeGreaterThan(0);
  });

  it("shows the error text when errorText is provided", () => {
    render(<Timeline events={[]} errorText="Mất kết nối" />);
    expect(screen.getByText("Mất kết nối")).toBeDefined();
  });
});
