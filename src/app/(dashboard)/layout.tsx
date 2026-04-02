import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

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
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        admin={{
          id: admin?.id ?? user.id,
          email: admin?.email ?? user.email ?? "",
          display_name: admin?.full_name ?? user.email?.split("@")[0] ?? "Admin",
          role: admin?.role ?? "admin",
        }}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          admin={{
            id: admin?.id ?? user.id,
            email: admin?.email ?? user.email ?? "",
            display_name: admin?.full_name ?? user.email?.split("@")[0] ?? "Admin",
            role: admin?.role ?? "admin",
          }}
        />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
