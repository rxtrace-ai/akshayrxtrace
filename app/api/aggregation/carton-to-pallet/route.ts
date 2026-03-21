import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveCompanyIdFromRequest } from "@/lib/company/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const supabase = getSupabaseAdmin();

    const companyId = await resolveCompanyIdFromRequest(req);
    if (!companyId) {
      return apiJson({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { pallet_sscc, carton_sscc_list } = body;

    if (!pallet_sscc || !Array.isArray(carton_sscc_list) || carton_sscc_list.length === 0) {
      return apiJson(
        { error: "pallet_sscc and carton_sscc_list are required" },
        { status: 400 }
      );
    }

    // get pallet id
    const { data: pallet, error: palletErr } = await supabase
      .from("pallets")
      .select("id")
      .eq("sscc", pallet_sscc)
      .single();

    if (palletErr || !pallet) {
      return apiJson({ error: "Pallet not found" }, { status: 404 });
    }

    // update cartons
    const { error: updateErr } = await supabase
      .from("cartons")
      .update({ pallet_id: pallet.id })
      .in("sscc", carton_sscc_list);

    if (updateErr) {
      return apiJson({ error: updateErr.message }, { status: 500 });
    }

    return apiJson({
      success: true,
      aggregated_cartons: carton_sscc_list.length,
      pallet_sscc
    });

  } catch (err: any) {
    return apiJson(
      { error: err?.message || "Aggregation failed" },
      { status: 500 }
    );
  }
}
