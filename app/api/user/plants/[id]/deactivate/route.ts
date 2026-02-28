import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { resolveCompanyForUser } from "@/lib/company/resolve";
import { writeAuditLog } from "@/lib/audit";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
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

  const plantId = String(params?.id || "").trim();
  if (!plantId) {
    return NextResponse.json({ error: "Invalid plant id" }, { status: 400 });
  }

  const { data: existing, error: findError } = await supabase
    .from("plants")
    .select("id, status")
    .eq("id", plantId)
    .eq("company_id", resolved.companyId)
    .maybeSingle();

  if (findError) {
    return NextResponse.json({ error: findError.message }, { status: 500 });
  }

  if (!existing) {
    return NextResponse.json({ error: "Plant not found" }, { status: 404 });
  }

  if (existing.status === "deactivated") {
    return NextResponse.json({ success: true, already_deactivated: true });
  }

  const { data: updated, error: updateError } = await supabase
    .from("plants")
    .update({
      status: "deactivated",
      activated_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", plantId)
    .eq("company_id", resolved.companyId)
    .select(
      "id, name, street_address, city_state, location_description, status, activated_at, created_at, updated_at"
    )
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  try {
    await writeAuditLog({
      companyId: resolved.companyId,
      actor: user.id,
      action: "PLANT_DEACTIVATED",
      status: "success",
      metadata: { plant_id: plantId },
    });
  } catch {
    // Non-blocking.
  }

  return NextResponse.json({ success: true, plant: updated });
}
