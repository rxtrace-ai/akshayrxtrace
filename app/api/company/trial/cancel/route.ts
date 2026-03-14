import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveCompanyForUser } from "@/lib/company/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getSupabaseAdmin();
    const resolved = await resolveCompanyForUser(admin, user.id, "id");
    if (!resolved?.companyId) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }
    if (!resolved.isOwner) {
      return NextResponse.json({ error: "Only the company owner can cancel trials" }, { status: 403 });
    }

    const { error } = await admin.rpc("cancel_company_trial", {
      p_company_id: resolved.companyId,
    });
    if (error) {
      console.error("CANCEL TRIAL ERROR:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("CANCEL TRIAL ERROR:", error);
    return NextResponse.json(
      { error: error?.message ?? "Failed to cancel trial" },
      { status: 500 }
    );
  }
}
