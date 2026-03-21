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

    const { box_sscc, unit_serials } = body;

    if (!box_sscc || !Array.isArray(unit_serials) || unit_serials.length === 0) {
      return apiJson(
        { error: "box_sscc and unit_serials are required" },
        { status: 400 }
      );
    }

    const { data: box, error: boxErr } = await supabase
      .from("boxes")
      .select("id, company_id")
      .eq("sscc", box_sscc)
      .maybeSingle();

    if (boxErr) throw boxErr;

    if (!box || box.company_id !== companyId) {
      return apiJson({ error: "Box not found" }, { status: 404 });
    }

    const { error: updateErr } = await supabase
      .from("labels_units")
      .update({ box_id: box.id })
      .in("serial", unit_serials)
      .eq("company_id", companyId);

    if (updateErr) throw updateErr;

    return apiJson({
      success: true,
      aggregated_units: unit_serials.length,
      box_sscc
    });

  } catch (err: any) {

    return apiJson(
      { error: err?.message || "Aggregation failed" },
      { status: 500 }
    );

  }

}
