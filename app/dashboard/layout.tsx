import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import { SubscriptionProvider } from "@/lib/hooks/useSubscription";
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
    <SubscriptionProvider>
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex flex-col flex-1">
          <Header />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </SubscriptionProvider>
  );
}
