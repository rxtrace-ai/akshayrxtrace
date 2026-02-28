import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { resolveCompanyForUser } from "@/lib/company/resolve";

export async function GET() {
  const supabase = await supabaseServer();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolved = await resolveCompanyForUser(supabase, user.id, "id");
  if (!resolved || !resolved.isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("plants")
    .select("id, name, status")
    .eq("company_id", resolved.companyId)
    .eq("status", "active")
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, plants: data || [] });
}
