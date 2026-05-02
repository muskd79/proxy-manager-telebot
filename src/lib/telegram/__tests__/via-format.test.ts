import { describe, it, expect } from "vitest";
import { msg } from "../messages";

/**
 * Wave 23E — regression tests pinning the Vietnamese-with-accents
 * + VIA-format port. If a refactor reintroduces unaccented Vietnamese
 * (Tai khoan, Khong, Yeu cau...) these tests scream BEFORE the bot
 * ships to users.
 *
 * Source: docs/PORT_VIA_TEXT_2026-05-02.md TASK 4 accent sweep.
 */

const UNACCENTED_BANLIST = [
  "Tai khoan",
  "Khong co",
  "Cac lenh",
  "Yeu cau",
  "Lich su",
  "Trang thai",
  "Huong dan",
  "Bao loi",
  "Sap het",
  "Da huy",
  "Su dung",
  "Theo gio",
  "Theo ngay",
  "Tong cong",
  "Ho tro",
  "Gui tin nhan",
  "Tin nhan da nhan",
  "Dang kiem tra",
  "Ket qua kiem tra",
  "Het han",
  "Chua co",
  "Gioi han",
  "thanh cong",
  "Ban co chac",
];

describe("Wave 23E — Vietnamese accents (VIA-format port)", () => {
  it("regression: messages.ts has zero unaccented Vietnamese in vi text", () => {
    const offenders: string[] = [];
    for (const [key, value] of Object.entries(msg)) {
      const vi = (value as { vi: string }).vi;
      for (const banned of UNACCENTED_BANLIST) {
        if (vi.includes(banned)) offenders.push(`${key}: "${banned}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("help text uses proper accents (Wave 23E port)", () => {
    expect(msg.help.vi).toContain("Hướng dẫn sử dụng");
    expect(msg.help.vi).toContain("Bắt đầu");
    expect(msg.help.vi).toContain("Yêu cầu");
    expect(msg.help.vi).toContain("Kiểm tra");
    expect(msg.help.vi.toLowerCase()).toContain("trạng thái");
    expect(msg.help.vi.toLowerCase()).toContain("lịch sử");
    expect(msg.help.vi).toContain("Hủy");
    // /support description has "Gửi tin nhắn cho admin"
    expect(msg.help.vi).toContain("Gửi tin");
    expect(msg.help.vi).toContain("Đổi ngôn ngữ");
    expect(msg.help.vi).toContain("Giới hạn");
    expect(msg.help.vi).toContain("Mỗi người dùng");
  });

  it("pendingApproval uses proper accents", () => {
    expect(msg.pendingApproval.vi).toContain("Tài khoản");
    expect(msg.pendingApproval.vi).toContain("đang chờ");
    expect(msg.pendingApproval.vi).toContain("phê duyệt");
  });

  it("supportMessageReceived uses proper accents", () => {
    expect(msg.supportMessageReceived.vi).toBe(
      "Tin nhắn đã nhận. Admin sẽ phản hồi sớm.",
    );
  });

  it("revokeConfirmAll uses proper accents", () => {
    expect(msg.revokeConfirmAll.vi).toContain("Bạn có chắc");
    expect(msg.revokeConfirmAll.vi).toContain("Hành động");
  });

  it("cancelConfirmPrompt is 'Hủy tất cả?'", () => {
    expect(msg.cancelConfirmPrompt.vi).toBe("Hủy tất cả?");
  });

  it("noAuth uses 'không xác thực'", () => {
    expect(msg.noAuth.vi).toBe("không xác thực");
  });

  it("expiresSoon uses 'Sắp hết hạn!'", () => {
    expect(msg.expiresSoon.vi).toBe("[!] Sắp hết hạn!");
  });

  it("bulkRequestPending uses 'đang chờ duyệt'", () => {
    expect(msg.bulkRequestPending.vi).toContain("Yêu cầu");
    expect(msg.bulkRequestPending.vi).toContain("đang chờ duyệt");
  });

  it("bulkPartialAssigned uses 'không khả dụng'", () => {
    expect(msg.bulkPartialAssigned.vi).toContain("Đã cấp");
    expect(msg.bulkPartialAssigned.vi).toContain("không khả dụng");
  });
});
