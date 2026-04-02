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

  // Fetch admin data
  const { data: admin } = await supabase
    .from("admins")
    .select("*")
    .eq("auth_user_id", user.id)
    .single();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        admin={
          admin ?? {
            id: user.id,
            email: user.email ?? "",
            display_name: user.email?.split("@")[0] ?? "Admin",
            role: "admin",
          }
        }
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          admin={
            admin ?? {
              id: user.id,
              email: user.email ?? "",
              display_name: user.email?.split("@")[0] ?? "Admin",
              role: "admin",
            }
          }
        />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
