import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { resolveCompanyForUser } from "@/lib/company/resolve";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/signin");
  }

  const admin = getSupabaseAdmin();
  const resolved = await resolveCompanyForUser(admin, user.id, "id, profile_completed");

  if (!resolved) {
    redirect("/onboarding/company-setup");
  }

  const company = resolved.company as Record<string, unknown>;
  if (resolved.isOwner && company.profile_completed === false) {
    redirect("/onboarding/company-setup?reason=complete_profile");
  }

  return (
    <div className="flex h-screen bg-[linear-gradient(180deg,#062C2D_0%,#083B3C_100%)]">
      <Sidebar />
      <div className="flex flex-col flex-1">
        <Header />
        <main className="flex-1 overflow-y-auto bg-[#F3F8F8] p-6">{children}</main>
      </div>
    </div>
  );
}
