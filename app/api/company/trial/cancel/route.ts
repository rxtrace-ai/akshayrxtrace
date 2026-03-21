import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
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
      return apiJson({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getSupabaseAdmin();
    const resolved = await resolveCompanyForUser(admin, user.id, "id");
    if (!resolved?.companyId) {
      return apiJson({ error: "Company not found" }, { status: 404 });
    }
    if (!resolved.isOwner) {
      return apiJson({ error: "Only the company owner can cancel trials" }, { status: 403 });
    }

    const { error } = await admin.rpc("cancel_company_trial", {
      p_company_id: resolved.companyId,
    });
    if (error) {
      console.error("CANCEL TRIAL ERROR:", error);
      return apiJson({ error: error.message }, { status: 500 });
    }

    return apiJson({ success: true });
  } catch (error: any) {
    console.error("CANCEL TRIAL ERROR:", error);
    return apiJson(
      { error: error?.message ?? "Failed to cancel trial" },
      { status: 500 }
    );
  }
}

