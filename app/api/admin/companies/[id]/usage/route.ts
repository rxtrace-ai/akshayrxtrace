import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/admin";
import { getCompanyEntitlementSnapshot } from "@/lib/entitlement/canonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { error: adminError } = await requireAdmin();
    if (adminError) return adminError;

    const supabase = getSupabaseAdmin();
    const companyId = params.id;
    const snapshot = await getCompanyEntitlementSnapshot(supabase, companyId);

    const historicalFrom = new Date();
    historicalFrom.setMonth(historicalFrom.getMonth() - 6);
    historicalFrom.setDate(1);

    const { data: historical, error: histError } = await supabase
      .from("usage_counters")
      .select("metric_type, period_start, used_quantity")
      .eq("company_id", companyId)
      .gte("period_start", historicalFrom.toISOString().split("T")[0])
      .order("period_start", { ascending: false });

    if (histError) throw histError;

    const usageWithLimits = {
      UNIT: {
        used: snapshot.usage.unit,
        limit_value: snapshot.limits.unit,
        limit_type: "HARD",
        exceeded: snapshot.remaining.unit <= 0,
      },
      BOX: {
        used: snapshot.usage.box,
        limit_value: snapshot.limits.box,
        limit_type: "HARD",
        exceeded: snapshot.remaining.box <= 0,
      },
      CARTON: {
        used: snapshot.usage.carton,
        limit_value: snapshot.limits.carton,
        limit_type: "HARD",
        exceeded: snapshot.remaining.carton <= 0,
      },
      SSCC: {
        used: snapshot.usage.pallet,
        limit_value: snapshot.limits.pallet,
        limit_type: "HARD",
        exceeded: snapshot.remaining.pallet <= 0,
      },
    };

    return NextResponse.json({
      success: true,
      current_period: {
        usage: usageWithLimits,
        state: snapshot.state,
      },
      seats: {
        max_seats: snapshot.limits.seat,
        used_seats: snapshot.usage.seat,
        available_seats: snapshot.remaining.seat,
        seats_from_plan: snapshot.limits.seat,
        seats_from_addons: 0,
      },
      plants: {
        max_plants: snapshot.limits.plant,
        used_plants: snapshot.usage.plant,
        available_plants: snapshot.remaining.plant,
      },
      historical: historical || [],
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
