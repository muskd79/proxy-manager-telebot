export const testAdmins = {
  superAdmin: {
    id: "admin-1",
    email: "super@test.com",
    full_name: "Super Admin",
    role: "super_admin" as const,
    is_active: true,
  },
  admin: {
    id: "admin-2",
    email: "admin@test.com",
    full_name: "Regular Admin",
    role: "admin" as const,
    is_active: true,
  },
  viewer: {
    id: "admin-3",
    email: "viewer@test.com",
    full_name: "Viewer",
    role: "viewer" as const,
    is_active: true,
  },
};
