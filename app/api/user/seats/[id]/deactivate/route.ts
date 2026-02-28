import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { resolveCompanyForUser } from "@/lib/company/resolve";

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

  const seatId = String(params?.id || "").trim();
  if (!seatId) {
    return NextResponse.json({ error: "INVALID_SEAT_ID" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("deactivate_seat_atomic", {
    p_company_id: resolved.companyId,
    p_actor_user_id: user.id,
    p_seat_id: seatId,
  });

  if (error) {
    const message = String(error.message || "Failed to deactivate seat");
    if (message.includes("SEAT_NOT_FOUND")) {
      return NextResponse.json({ error: "SEAT_NOT_FOUND" }, { status: 404 });
    }
    if (message.includes("OWNER_SEAT_CANNOT_BE_DEACTIVATED")) {
      return NextResponse.json({ error: "OWNER_SEAT_CANNOT_BE_DEACTIVATED" }, { status: 400 });
    }
    if (message.includes("FORBIDDEN")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (message.includes("COMPANY_NOT_FOUND")) {
      return NextResponse.json({ error: "COMPANY_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const payload = Array.isArray(data) ? data[0] : data;
  return NextResponse.json(payload ?? { success: true });
}
