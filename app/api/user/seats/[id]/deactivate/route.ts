import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { supabaseServer } from "@/lib/supabase/server";
import { resolveCompanyForUser } from "@/lib/company/resolve";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const params = await ctx.params;
  const supabase = await supabaseServer();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return apiJson({ error: "Unauthorized" }, { status: 401 });
  }

  const resolved = await resolveCompanyForUser(supabase, user.id, "id");
  if (!resolved || !resolved.isOwner) {
    return apiJson({ error: "Forbidden" }, { status: 403 });
  }

  const seatId = String(params?.id || "").trim();
  if (!seatId) {
    return apiJson({ error: "INVALID_SEAT_ID" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("deactivate_seat_atomic", {
    p_company_id: resolved.companyId,
    p_actor_user_id: user.id,
    p_seat_id: seatId,
  });

  if (error) {
    const message = String(error.message || "Failed to deactivate seat");
    if (message.includes("SEAT_NOT_FOUND")) {
      return apiJson({ error: "SEAT_NOT_FOUND" }, { status: 404 });
    }
    if (message.includes("OWNER_SEAT_CANNOT_BE_DEACTIVATED")) {
      return apiJson({ error: "OWNER_SEAT_CANNOT_BE_DEACTIVATED" }, { status: 400 });
    }
    if (message.includes("FORBIDDEN")) {
      return apiJson({ error: "Forbidden" }, { status: 403 });
    }
    if (message.includes("COMPANY_NOT_FOUND")) {
      return apiJson({ error: "COMPANY_NOT_FOUND" }, { status: 404 });
    }
    return apiJson({ error: message }, { status: 500 });
  }

  const payload = Array.isArray(data) ? data[0] : data;
  return apiJson(payload ?? { success: true });
}
