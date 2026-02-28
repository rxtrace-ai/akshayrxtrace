import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveCompanyIdFromRequest } from "@/lib/company/resolve";
import { getCompanyEntitlementSnapshot } from "@/lib/entitlement/canonical";

export async function POST(req: Request) {
  try {
    const authCompanyId = await resolveCompanyIdFromRequest(req);
    if (!authCompanyId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const body = await req.json().catch(() => ({} as any));
    const requestedCompanyId = body.company_id as string | undefined;

    if (requestedCompanyId && requestedCompanyId !== authCompanyId) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const companyId = authCompanyId;
    const snapshot = await getCompanyEntitlementSnapshot(supabase, companyId);

    if (snapshot.state === "TRIAL_EXPIRED") {
      return NextResponse.json({ success: false, error: "TRIAL_EXPIRED" }, { status: 403 });
    }
    if (snapshot.state === "NO_ACTIVE_SUBSCRIPTION") {
      return NextResponse.json({ success: false, error: "NO_ACTIVE_SUBSCRIPTION" }, { status: 403 });
    }

    const remainingSeats = Number(snapshot.remaining?.seat ?? 0);
    if (remainingSeats <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: "SEAT_QUOTA_EXCEEDED",
          max_seats: Number(snapshot.limits?.seat ?? 0),
          used_seats: Number(snapshot.usage?.seat ?? 0),
          available_seats: 0,
        },
        { status: 403 }
      );
    }

    const { data: seat, error } = await supabase
      .from("seats")
      .insert({
        company_id: companyId,
        active: true,
        status: "active",
        activated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Seat allocated", seat });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || String(err) }, { status: 500 });
  }
}
