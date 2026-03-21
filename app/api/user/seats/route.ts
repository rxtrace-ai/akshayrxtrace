import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { supabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
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
  const admin = getSupabaseAdmin();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return apiJson({ error: "Unauthorized" }, { status: 401 });
  }

  const resolved = await resolveCompanyForUser(admin, user.id, "id");
  if (!resolved || !resolved.isOwner) {
    return apiJson({ error: "Forbidden" }, { status: 403 });
  }

  const entitlement = await getSeatEntitlement(admin, resolved.companyId);

  const { data: seats, error: seatsError } = await admin
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
      updated_at
    `)
    .eq("company_id", resolved.companyId)
    .order("created_at", { ascending: false });

  if (seatsError) {
    return apiJson({ error: seatsError.message }, { status: 500 });
  }

  const seatIds = (seats || []).map((seat) => seat.id);
  const userIds = Array.from(
    new Set(
      (seats || [])
        .map((seat: any) => seat.user_id)
        .filter((value: unknown): value is string => typeof value === "string" && value.length > 0)
    )
  );

  const { data: assignments, error: assignmentsError } =
    seatIds.length > 0
      ? await admin
          .from("seat_plant_assignments")
          .select("seat_id, plant_id, status, plants(id, name, status)")
          .eq("company_id", resolved.companyId)
          .in("seat_id", seatIds)
          .eq("status", "active")
      : { data: [], error: null };

  if (assignmentsError) {
    return apiJson({ error: assignmentsError.message }, { status: 500 });
  }

  const { data: invitations, error: invitesError } =
    seatIds.length > 0
      ? await admin
          .from("seat_invitations")
          .select("id, seat_id, status, expires_at, consumed_at, created_at")
          .eq("company_id", resolved.companyId)
          .in("seat_id", seatIds)
          .order("created_at", { ascending: false })
      : { data: [], error: null };

  if (invitesError) {
    return apiJson({ error: invitesError.message }, { status: 500 });
  }

  const { data: profiles, error: profilesError } =
    userIds.length > 0
      ? await admin
          .from("user_profiles")
          .select("user_id, full_name")
          .in("user_id", userIds)
      : { data: [], error: null };

  if (profilesError) {
    return apiJson({ error: profilesError.message }, { status: 500 });
  }
  const fullNameByUserId = new Map<string, string | null>();
  for (const profile of profiles || []) {
    const userId = (profile as any).user_id ? String((profile as any).user_id) : null;
    const name = (profile as any).full_name ?? null;
    if (userId) fullNameByUserId.set(userId, name);
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

    const full_name = seat.user_id ? fullNameByUserId.get(seat.user_id) ?? null : null;
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

  return apiJson({
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

