import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { RoleProvider } from "@/lib/role-context";
import { I18nProvider } from "@/lib/i18n";
import { SharedCacheProvider } from "@/lib/shared-cache";
import type { Role } from "@/lib/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch admin data by email
  const { data: admin } = await supabase
    .from("admins")
    .select("*")
    .eq("email", user.email)
    .single();

  return (
    <RoleProvider role={(admin?.role as Role) ?? "viewer"}>
      <I18nProvider>
        <SharedCacheProvider>
        {/* Wave 22N — WCAG 2.1 AA: skip-to-content link.
            Hidden until keyboard focus, then jumps screen-reader / keyboard
            users past the sidebar + header straight to <main>. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Bỏ qua, tới nội dung chính
        </a>
        <div className="flex h-screen overflow-hidden bg-background">
          <Sidebar
            admin={{
              id: admin?.id ?? user.id,
              email: admin?.email ?? user.email ?? "",
              display_name: admin?.full_name ?? user.email?.split("@")[0] ?? "Admin",
              // Wave 22E-5 CRITICAL FIX (B1): default to "viewer" not "admin".
              // An authenticated user with no row in the admins table (deleted
              // admin, race during creation) used to receive "admin" — passing
              // every client-side `useRole` minRole guard. Server-side
              // requireAdminOrAbove still queried the DB and was safe; only
              // the UI gates were bypassable. Default-deny is correct here.
              role: admin?.role ?? "viewer",
            }}
          />
          <div className="flex flex-1 flex-col overflow-hidden">
            <Header
              admin={{
                id: admin?.id ?? user.id,
                email: admin?.email ?? user.email ?? "",
                display_name: admin?.full_name ?? user.email?.split("@")[0] ?? "Admin",
                // Wave 22E-5 CRITICAL FIX (B1): default to "viewer" not "admin".
              // An authenticated user with no row in the admins table (deleted
              // admin, race during creation) used to receive "admin" — passing
              // every client-side `useRole` minRole guard. Server-side
              // requireAdminOrAbove still queried the DB and was safe; only
              // the UI gates were bypassable. Default-deny is correct here.
              role: admin?.role ?? "viewer",
              }}
            />
            <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 md:p-6 focus:outline-none">
              {children}
            </main>
          </div>
        </div>
        </SharedCacheProvider>
      </I18nProvider>
    </RoleProvider>
  );
}
