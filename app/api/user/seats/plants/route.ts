import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { supabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveCompanyForUser } from "@/lib/company/resolve";

export async function GET() {
  const supabase = await supabaseServer();
  const admin = getSupabaseAdmin();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return apiJson({ error: "Unauthorized" }, { status: 401 });
  }

  const resolved = await resolveCompanyForUser(admin, user.id, "id");
  if (!resolved || !resolved.isOwner) {
    return apiJson({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await admin
    .from("plants")
    .select("id, name, status")
    .eq("company_id", resolved.companyId)
    .eq("status", "active")
    .order("name", { ascending: true });

  if (error) {
    return apiJson({ error: error.message }, { status: 500 });
  }

  return apiJson({ success: true, plants: data || [] });
}

