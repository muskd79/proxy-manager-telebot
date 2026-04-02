"use client";

import { createContext, useContext } from "react";
import type { Role } from "./auth";

interface RoleContextValue {
  role: Role;
  canWrite: boolean;
  canManageAdmins: boolean;
  canManageSettings: boolean;
}

const RoleContext = createContext<RoleContextValue>({
  role: "viewer",
  canWrite: false,
  canManageAdmins: false,
  canManageSettings: false,
});

export function RoleProvider({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  const value: RoleContextValue = {
    role,
    canWrite: role === "super_admin" || role === "admin",
    canManageAdmins: role === "super_admin",
    canManageSettings: role === "super_admin",
  };

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  return useContext(RoleContext);
}
