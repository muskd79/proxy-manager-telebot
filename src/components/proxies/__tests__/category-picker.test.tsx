import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CategoryPicker } from "../category-picker";

/**
 * Wave 26-A — pin the UUID-display fix.
 *
 * Pre-fix: when a category was created inline, parent state propagated
 * a tick later than `onValueChange(newId)` — shadcn <SelectValue>
 * couldn't find a matching <SelectItem> and rendered the raw UUID
 * (e.g. "6e153c3a-2694-4f50-82e4-b04943eede69"). User report 2026-05-03.
 *
 * Now CategoryPicker resolves the display label itself from
 * `value` + `categories`. The trigger never shows a raw UUID.
 */
describe("CategoryPicker — display label resolution (Wave 26-A)", () => {
  const noopFns = {
    onValueChange: vi.fn(),
    onCategoryCreated: vi.fn(),
  };

  it("shows placeholder when value is empty", () => {
    render(
      <CategoryPicker
        value=""
        categories={[]}
        {...noopFns}
        placeholder="Không phân loại"
      />,
    );
    expect(screen.getByText("Không phân loại")).toBeDefined();
  });

  it("shows category name when value matches a known category", () => {
    render(
      <CategoryPicker
        value="cat-1"
        categories={[
          { id: "cat-1", name: "VN Mobile 4G", default_proxy_type: "http", default_country: "VN" },
        ]}
        {...noopFns}
      />,
    );
    expect(screen.getByText(/VN Mobile 4G · HTTP · VN/)).toBeDefined();
  });

  it("does NOT show raw UUID when value points at an unknown category (just-created race)", () => {
    const newlyCreatedUuid = "6e153c3a-2694-4f50-82e4-b04943eede69";
    const { container } = render(
      <CategoryPicker
        value={newlyCreatedUuid}
        // Categories list hasn't propagated yet (parent state lag).
        categories={[]}
        {...noopFns}
      />,
    );
    // Negative assertion: the raw UUID must NEVER appear in the trigger.
    expect(container.textContent).not.toContain(newlyCreatedUuid);
    // Positive assertion: friendly fallback is shown instead.
    expect(screen.getByText("Đang tải danh mục…")).toBeDefined();
  });

  it("recovers to category name once parent updates the list", () => {
    const id = "cat-2";
    const { rerender, container } = render(
      <CategoryPicker value={id} categories={[]} {...noopFns} />,
    );
    expect(container.textContent).not.toContain(id);

    // Parent finally adds the row → trigger should switch to the name.
    rerender(
      <CategoryPicker
        value={id}
        categories={[{ id, name: "Just Created", default_proxy_type: null, default_country: null }]}
        {...noopFns}
      />,
    );
    expect(screen.getByText("Just Created")).toBeDefined();
  });

  it("renders only the name when category has no defaults", () => {
    render(
      <CategoryPicker
        value="cat-3"
        categories={[{ id: "cat-3", name: "Plain Category" }]}
        {...noopFns}
      />,
    );
    // Should be exactly "Plain Category" (no extra dots/dashes).
    expect(screen.getByText("Plain Category")).toBeDefined();
  });
});
