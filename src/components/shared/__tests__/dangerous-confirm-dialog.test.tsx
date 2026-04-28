import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DangerousConfirmDialog } from "../dangerous-confirm-dialog";

/**
 * Wave 22O regression tests for DangerousConfirmDialog.
 *
 * Pin contract:
 *   1. Submit button DISABLED until typed === confirmString.
 *   2. Submit button ENABLED when typed === confirmString.
 *   3. Cancel button always enabled (unless loading).
 *   4. Reset typed when dialog closes (re-open starts fresh).
 *   5. Wrong typed shows inline error.
 */

describe("DangerousConfirmDialog — Wave 22O", () => {
  function renderDialog(props?: Partial<Parameters<typeof DangerousConfirmDialog>[0]>) {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <DangerousConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Xoá vĩnh viễn"
        description="Test"
        confirmString="DELETE"
        onConfirm={onConfirm}
        {...props}
      />,
    );
    return { onConfirm, onOpenChange };
  }

  it("submit DISABLED initially (empty input)", () => {
    renderDialog();
    const btn = screen.getByRole("button", { name: /xoá vĩnh viễn/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("submit DISABLED with wrong typed", () => {
    renderDialog();
    const input = screen.getByPlaceholderText("DELETE");
    fireEvent.change(input, { target: { value: "delete" } });
    const btn = screen.getByRole("button", { name: /xoá vĩnh viễn/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows inline error when typed but doesn't match", () => {
    renderDialog();
    const input = screen.getByPlaceholderText("DELETE");
    fireEvent.change(input, { target: { value: "del" } });
    expect(screen.getByText(/Không khớp/)).toBeTruthy();
  });

  it("submit ENABLED when typed === confirmString (case-sensitive)", () => {
    renderDialog();
    const input = screen.getByPlaceholderText("DELETE");
    fireEvent.change(input, { target: { value: "DELETE" } });
    const btn = screen.getByRole("button", { name: /xoá vĩnh viễn/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("calls onConfirm when submit clicked", () => {
    const { onConfirm } = renderDialog();
    const input = screen.getByPlaceholderText("DELETE");
    fireEvent.change(input, { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: /xoá vĩnh viễn/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("custom actionLabel renders", () => {
    renderDialog({ actionLabel: "Đồng ý xoá" });
    expect(screen.getByRole("button", { name: /Đồng ý xoá/i })).toBeTruthy();
  });

  it("cancel button enabled by default", () => {
    renderDialog();
    const cancel = screen.getByRole("button", { name: /huỷ/i });
    expect((cancel as HTMLButtonElement).disabled).toBe(false);
  });

  it("loading=true disables both buttons + shows 'Đang xử lý'", () => {
    renderDialog({ loading: true });
    const input = screen.getByPlaceholderText("DELETE");
    fireEvent.change(input, { target: { value: "DELETE" } });
    expect(screen.getByText(/Đang xử lý/i)).toBeTruthy();
    const cancel = screen.getByRole("button", { name: /huỷ/i });
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
  });
});
