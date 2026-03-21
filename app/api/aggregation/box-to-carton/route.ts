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

    const { carton_sscc, box_sscc_list } = body;

    if (!carton_sscc || !Array.isArray(box_sscc_list) || box_sscc_list.length === 0) {
      return apiJson(
        { error: "carton_sscc and box_sscc_list are required" },
        { status: 400 }
      );
    }

    const { data: carton, error: cartonErr } = await supabase
      .from("cartons")
      .select("id, company_id")
      .eq("sscc", carton_sscc)
      .maybeSingle();

    if (cartonErr) throw cartonErr;

    if (!carton || carton.company_id !== companyId) {
      return apiJson({ error: "Carton not found" }, { status: 404 });
    }

    const { error: updateErr } = await supabase
      .from("boxes")
      .update({ carton_id: carton.id })
      .in("sscc", box_sscc_list)
      .eq("company_id", companyId);

    if (updateErr) throw updateErr;

    return apiJson({
      success: true,
      aggregated_boxes: box_sscc_list.length,
      carton_sscc
    });

  } catch (err: any) {

    return apiJson(
      { error: err?.message || "Aggregation failed" },
      { status: 500 }
    );

  }
}
