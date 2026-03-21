import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { supabaseServer } from "@/lib/supabase/server";
import { resolveCompanyForUser } from "@/lib/company/resolve";
import { getPlantEntitlement } from "@/lib/plants/entitlement";

const PLANT_FIELDS =
  "id, name, street_address, city_state, location_description, status, activated_at, created_at, updated_at";

export async function GET() {
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

  const { data, error } = await supabase
    .from("plants")
    .select(`${PLANT_FIELDS}`)
    .eq("company_id", resolved.companyId)
    .order("created_at", { ascending: false });

  if (error) {
    return apiJson({ error: error.message }, { status: 500 });
  }

  const rows = data || [];
  const entitlement = await getPlantEntitlement(supabase, resolved.companyId);

  return apiJson({
    success: true,
    summary: {
      allocated: entitlement.allocated,
      active: entitlement.active,
      remaining: entitlement.remaining,
      blocked: entitlement.blocked,
      reason: entitlement.reason,
    },
    plants: rows,
  });
}

export async function POST(req: Request) {
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

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const street_address = String(body.street_address || "").trim();
  const city_state = String(body.city_state || "").trim();
  const location_description = String(body.location_description || "").trim();

  if (!name || !street_address || !city_state) {
    return apiJson({ error: "Missing required fields" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("activate_plant_atomic", {
    p_company_id: resolved.companyId,
    p_actor_user_id: user.id,
    p_name: name,
    p_street_address: street_address,
    p_city_state: city_state,
    p_location_description: location_description || null,
  });

  if (error) {
    const message = String(error.message || "Plant activation failed");
    if (message.includes("TRIAL_EXPIRED")) {
      return apiJson({ error: "TRIAL_EXPIRED" }, { status: 403 });
    }
    if (message.includes("PLANT_QUOTA_EXCEEDED")) {
      return apiJson({ error: "PLANT_QUOTA_EXCEEDED" }, { status: 403 });
    }
    if (message.includes("COMPANY_FROZEN")) {
      return apiJson({ error: "COMPANY_FROZEN" }, { status: 403 });
    }
    if (message.includes("FORBIDDEN")) {
      return apiJson({ error: "Forbidden" }, { status: 403 });
    }
    if (message.includes("plants_company_normalized_name_key")) {
      return apiJson({ error: "PLANT_NAME_ALREADY_EXISTS" }, { status: 409 });
    }
    return apiJson({ error: message }, { status: 500 });
  }

  const rpcPayload = Array.isArray(data) ? data[0] : data;
  return apiJson(rpcPayload ?? { success: true });
}

