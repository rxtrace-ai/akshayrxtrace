import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit";
import { getCompanyEntitlementSnapshot } from "@/lib/entitlement/canonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveAuthCompanyId() {
  const supabase = await supabaseServer();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return { user: null as any, companyId: null as string | null };

  const admin = getSupabaseAdmin();
  const { data: company } = await admin
    .from("companies")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  return { user, companyId: (company as any)?.id ?? null };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const seatId = body.seat_id as string | undefined;
    const requestedCompanyId = body.company_id as string | undefined;

    if (!seatId) {
      return NextResponse.json({ success: false, error: "seat_id required" }, { status: 400 });
    }

    const { user, companyId } = await resolveAuthCompanyId();
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!companyId) return NextResponse.json({ success: false, error: "No company found" }, { status: 403 });

    if (requestedCompanyId && requestedCompanyId !== companyId) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const supabase = getSupabaseAdmin();

    const { data: seatRow, error: seatError } = await supabase
      .from("seats")
      .select("id, company_id, status, active")
      .eq("id", seatId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (seatError) {
      return NextResponse.json({ success: false, error: seatError.message }, { status: 500 });
    }
    if (!seatRow) {
      return NextResponse.json({ success: false, error: "Seat not found" }, { status: 404 });
    }

    if ((seatRow as any).status === "active" || (seatRow as any).active === true) {
      return NextResponse.json({ success: true, seat: seatRow, message: "Already active" });
    }

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

    const now = new Date().toISOString();

    const { data: updated, error: updateError } = await supabase
      .from("seats")
      .update({ status: "active", active: true, activated_at: now })
      .eq("id", seatId)
      .select()
      .single();

    if (updateError || !updated) {
      return NextResponse.json({ success: false, error: updateError?.message || "Failed to activate" }, { status: 500 });
    }

    try {
      await writeAuditLog({
        companyId,
        actor: (user as any)?.email ?? (user as any)?.id ?? "unknown",
        action: "seat_activated",
        status: "success",
        metadata: { seat_id: seatId },
      });
    } catch {
      // ignore audit failures
    }

    return NextResponse.json({ success: true, seat: updated, message: "User ID activated" });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || String(err) }, { status: 500 });
  }
}
