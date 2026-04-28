import { describe, it, expect } from "vitest";
import {
  canWrite,
  canManageAdmins,
  canManageSettings,
  roleLevel,
  meetsMinRole,
  ROLE_LEVELS,
  MIN,
} from "../auth";

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

// ============================================================
// Wave 22D — numeric role hierarchy regression tests
// ============================================================

describe("Wave 22D — numeric role hierarchy", () => {
  describe("ROLE_LEVELS constants", () => {
    it("super_admin > admin > viewer (strict ordering)", () => {
      expect(ROLE_LEVELS.super_admin).toBeGreaterThan(ROLE_LEVELS.admin);
      expect(ROLE_LEVELS.admin).toBeGreaterThan(ROLE_LEVELS.viewer);
    });

    it("levels are spaced for future tiers (gap >= 10)", () => {
      // A future role between admin and super_admin must be insertable
      // without renumbering. We document the contract: each gap >= 10.
      expect(ROLE_LEVELS.admin - ROLE_LEVELS.viewer).toBeGreaterThanOrEqual(10);
      expect(ROLE_LEVELS.super_admin - ROLE_LEVELS.admin).toBeGreaterThanOrEqual(
        10,
      );
    });

    it("MIN aliases match ROLE_LEVELS", () => {
      expect(MIN.VIEWER).toBe(ROLE_LEVELS.viewer);
      expect(MIN.ADMIN).toBe(ROLE_LEVELS.admin);
      expect(MIN.SUPER_ADMIN).toBe(ROLE_LEVELS.super_admin);
    });
  });

  describe("roleLevel", () => {
    it("returns the numeric level for each known role", () => {
      expect(roleLevel("viewer")).toBe(ROLE_LEVELS.viewer);
      expect(roleLevel("admin")).toBe(ROLE_LEVELS.admin);
      expect(roleLevel("super_admin")).toBe(ROLE_LEVELS.super_admin);
    });
  });

  describe("meetsMinRole", () => {
    // 9 cases: every role × every minimum tier
    it("super_admin meets every tier", () => {
      expect(meetsMinRole("super_admin", MIN.VIEWER)).toBe(true);
      expect(meetsMinRole("super_admin", MIN.ADMIN)).toBe(true);
      expect(meetsMinRole("super_admin", MIN.SUPER_ADMIN)).toBe(true);
    });

    it("admin meets viewer + admin but not super_admin", () => {
      expect(meetsMinRole("admin", MIN.VIEWER)).toBe(true);
      expect(meetsMinRole("admin", MIN.ADMIN)).toBe(true);
      expect(meetsMinRole("admin", MIN.SUPER_ADMIN)).toBe(false);
    });

    it("viewer meets only viewer", () => {
      expect(meetsMinRole("viewer", MIN.VIEWER)).toBe(true);
      expect(meetsMinRole("viewer", MIN.ADMIN)).toBe(false);
      expect(meetsMinRole("viewer", MIN.SUPER_ADMIN)).toBe(false);
    });
  });

  describe("capability helpers reduce to meetsMinRole", () => {
    // Wave 22D contract: canWrite/canManageAdmins/canManageSettings
    // are now thin wrappers. This test pins that the wrappers return
    // EXACTLY what meetsMinRole returns — any future divergence breaks
    // the test.
    it("canWrite === meetsMinRole(MIN.ADMIN)", () => {
      for (const r of ["super_admin", "admin", "viewer"] as const) {
        expect(canWrite(r)).toBe(meetsMinRole(r, MIN.ADMIN));
      }
    });
    it("canManageAdmins === meetsMinRole(MIN.SUPER_ADMIN)", () => {
      for (const r of ["super_admin", "admin", "viewer"] as const) {
        expect(canManageAdmins(r)).toBe(meetsMinRole(r, MIN.SUPER_ADMIN));
      }
    });
    it("canManageSettings === meetsMinRole(MIN.SUPER_ADMIN)", () => {
      for (const r of ["super_admin", "admin", "viewer"] as const) {
        expect(canManageSettings(r)).toBe(meetsMinRole(r, MIN.SUPER_ADMIN));
      }
    });
  });
});
