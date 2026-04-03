import { describe, it, expect } from "vitest";
import { canWrite, canManageAdmins, canManageSettings } from "../auth";

describe("auth role helpers", () => {
  describe("canWrite", () => {
    it("super_admin can write", () => {
      expect(canWrite("super_admin")).toBe(true);
    });
    it("admin can write", () => {
      expect(canWrite("admin")).toBe(true);
    });
    it("viewer cannot write", () => {
      expect(canWrite("viewer")).toBe(false);
    });
  });

  describe("canManageAdmins", () => {
    it("super_admin can manage admins", () => {
      expect(canManageAdmins("super_admin")).toBe(true);
    });
    it("admin cannot manage admins", () => {
      expect(canManageAdmins("admin")).toBe(false);
    });
    it("viewer cannot manage admins", () => {
      expect(canManageAdmins("viewer")).toBe(false);
    });
  });

  describe("canManageSettings", () => {
    it("super_admin can manage settings", () => {
      expect(canManageSettings("super_admin")).toBe(true);
    });
    it("admin cannot manage settings", () => {
      expect(canManageSettings("admin")).toBe(false);
    });
  });
});
