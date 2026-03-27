import { SupabaseClient } from '@supabase/supabase-js';
import { getCompanyEntitlementSnapshot } from '@/lib/entitlement/canonical';

async function getSeatAllocationBreakdown(
  supabase: SupabaseClient,
  company_id: string,
  atIso: string
): Promise<{ seatsFromPlan: number; seatsFromAddons: number }> {
  const { data, error } = await supabase
    .from('quota_allocations')
    .select('source, amount')
    .eq('company_id', company_id)
    .eq('resource', 'seats')
    .gt('expires_at', atIso);

  if (error) throw error;

  return ((data as Array<{ source: string | null; amount: number | null }>) || []).reduce(
    (acc, row) => {
      const amount = Math.max(0, Math.trunc(Number(row.amount ?? 0)));
      if (row.source === 'subscription' || row.source === 'trial') {
        acc.seatsFromPlan += amount;
      } else if (row.source === 'addon') {
        acc.seatsFromAddons += amount;
      }
      return acc;
    },
    { seatsFromPlan: 0, seatsFromAddons: 0 }
  );
}

/**
 * Get seat limits for a company from the canonical entitlement ledger.
 */
export async function getSeatLimits(
  supabase: SupabaseClient,
  company_id: string
): Promise<{
  max_seats: number;
  used_seats: number;
  available_seats: number;
  seats_from_plan: number;
  seats_from_addons: number;
}> {
  const atIso = new Date().toISOString();
  const [snapshot, allocationBreakdown] = await Promise.all([
    getCompanyEntitlementSnapshot(supabase, company_id, atIso),
    getSeatAllocationBreakdown(supabase, company_id, atIso),
  ]);

  const maxSeats = Math.max(0, Math.trunc(snapshot.limits.seat ?? 0));
  const usedSeats = Math.max(0, Math.trunc(snapshot.usage.seat ?? 0));
  const availableSeats = Math.max(0, Math.trunc(snapshot.remaining.seat ?? 0));

  return {
    max_seats: maxSeats,
    used_seats: usedSeats,
    available_seats: availableSeats,
    seats_from_plan: allocationBreakdown.seatsFromPlan,
    seats_from_addons: allocationBreakdown.seatsFromAddons,
  };
}

/**
 * Check if a new seat can be created.
 */
export async function canCreateSeat(
  supabase: SupabaseClient,
  company_id: string
): Promise<{
  allowed: boolean;
  reason?: string;
  max_seats: number;
  used_seats: number;
  available_seats: number;
}> {
  const limits = await getSeatLimits(supabase, company_id);

  if (limits.used_seats >= limits.max_seats) {
    supabase.from('audit_logs').insert({
      action: 'SEAT_LIMIT_REACHED',
      company_id,
      metadata: {
        max_seats: limits.max_seats,
        used_seats: limits.used_seats,
        available_seats: limits.available_seats,
      },
    }).then(({ error }) => {
      if (error) {
        console.error('Failed to log seat limit:', error);
      }
    });

    return {
      allowed: false,
      reason: `Seat limit reached. Used: ${limits.used_seats}, Allowed: ${limits.max_seats}`,
      ...limits,
    };
  }

  return {
    allowed: true,
    ...limits,
  };
}
