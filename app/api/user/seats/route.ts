import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { resolveCompanyForUser } from "@/lib/company/resolve";
import { getSeatEntitlement } from "@/lib/seats/entitlement";

type SeatRow = {
  id: string;
  email: string | null;
  role: string | null;
  status: string | null;
  active: boolean | null;
  invited_at: string | null;
  activated_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  user_id: string | null;
};

export async function GET() {
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

  const entitlement = await getSeatEntitlement(supabase, resolved.companyId);

  const { data: seats, error: seatsError } = await supabase
    .from("seats")
    .select(`
      id,
      user_id,
      email,
      role,
      status,
      active,
      invited_at,
      activated_at,
      created_at,
      updated_at,
      user_profiles ( full_name )
    `)
    .eq("company_id", resolved.companyId)
    .order("created_at", { ascending: false });

  if (seatsError) {
    return NextResponse.json({ error: seatsError.message }, { status: 500 });
  }

  const seatIds = (seats || []).map((seat) => seat.id);

  const { data: assignments, error: assignmentsError } =
    seatIds.length > 0
      ? await supabase
          .from("seat_plant_assignments")
          .select("seat_id, plant_id, status, plants(id, name, status)")
          .eq("company_id", resolved.companyId)
          .in("seat_id", seatIds)
          .eq("status", "active")
      : { data: [], error: null };

  if (assignmentsError) {
    return NextResponse.json({ error: assignmentsError.message }, { status: 500 });
  }

  const { data: invitations, error: invitesError } =
    seatIds.length > 0
      ? await supabase
          .from("seat_invitations")
          .select("id, seat_id, status, expires_at, consumed_at, created_at")
          .eq("company_id", resolved.companyId)
          .in("seat_id", seatIds)
          .order("created_at", { ascending: false })
      : { data: [], error: null };

  if (invitesError) {
    return NextResponse.json({ error: invitesError.message }, { status: 500 });
  }

  const plantsBySeat = new Map<
    string,
    Array<{ id: string; name: string | null; status: string | null }>
  >();
  for (const assignment of assignments || []) {
    const seatId = String((assignment as any).seat_id);
    const plant = (assignment as any).plants;
    if (!plantsBySeat.has(seatId)) {
      plantsBySeat.set(seatId, []);
    }
    plantsBySeat.get(seatId)!.push({
      id: String((assignment as any).plant_id),
      name: plant?.name ?? null,
      status: plant?.status ?? null,
    });
  }

  const latestInviteBySeat = new Map<
    string,
    { id: string; status: string; expires_at: string | null; consumed_at: string | null }
  >();
  for (const invite of invitations || []) {
    const seatId = String((invite as any).seat_id);
    if (!latestInviteBySeat.has(seatId)) {
      latestInviteBySeat.set(seatId, {
        id: String((invite as any).id),
        status: String((invite as any).status || "pending"),
        expires_at: (invite as any).expires_at ?? null,
        consumed_at: (invite as any).consumed_at ?? null,
      });
    }
  }

  const rows = (seats || []).map((seatRaw) => {
    const seat = seatRaw as SeatRow;
    const assignedPlants = plantsBySeat.get(seat.id) || [];
    const invitation = latestInviteBySeat.get(seat.id) || null;

    const full_name = (seatRaw as any).user_profiles?.full_name ?? null;
    return {
      id: seat.id,
      user_id: seat.user_id,
      email: seat.email,
      full_name,
      role: seat.role,
      status: seat.status,
      active: seat.active,
      invited_at: seat.invited_at,
      activated_at: seat.activated_at,
      created_at: seat.created_at,
      updated_at: seat.updated_at,
      assigned_plants: assignedPlants,
      plant_ids: assignedPlants.map((plant) => plant.id),
      invitation,
    };
  });
  const pendingCount = rows.filter((row) => row.status === "pending").length;
  const remainingInvitable = Math.max(
    0,
    Number(entitlement.allocated || 0) - Number(entitlement.active || 0) - pendingCount
  );
  const blockedByTrial = entitlement.reason === "trial_expired";

  return NextResponse.json({
    success: true,
    summary: {
      allocated: entitlement.allocated,
      active: entitlement.active,
      pending: pendingCount,
      remaining: remainingInvitable,
      blocked: blockedByTrial || remainingInvitable <= 0,
      reason: blockedByTrial ? "trial_expired" : remainingInvitable <= 0 ? "quota_exceeded" : null,
    },
    seats: rows,
  });
}
