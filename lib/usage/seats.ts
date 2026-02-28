import { SupabaseClient } from '@supabase/supabase-js';
import { getTrialSeatUsage, getTrialStatus, TRIAL_LIMITS } from '@/lib/trial';

/**
 * Get seat limits for a company
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
  const { data: trialRow } = await supabase
    .from('companies')
    .select('trial_started_at, trial_expires_at')
    .eq('id', company_id)
    .maybeSingle();

  if (trialRow) {
    const trialStatus = getTrialStatus(trialRow);
    if (trialStatus.active) {
      const usedSeats = await getTrialSeatUsage(supabase, company_id);
      const max = TRIAL_LIMITS.seat;
      return {
        max_seats: max,
        used_seats: usedSeats,
        available_seats: Math.max(0, max - usedSeats),
        seats_from_plan: max,
        seats_from_addons: 0,
      };
    }
  }
  // Get subscription
  const { data: subscription } = await supabase
    .from('company_subscriptions')
    .select(`
      plan_id,
      subscription_plans!inner(max_users)
    `)
    .eq('company_id', company_id)
    .eq('status', 'ACTIVE')
    .maybeSingle();

  const plan = Array.isArray(subscription?.subscription_plans) 
    ? subscription.subscription_plans[0] 
    : subscription?.subscription_plans;
  const seatsFromPlan = (plan as { max_users?: number } | undefined)?.max_users || 1;

  // Get seat add-ons
  const { data: addOns } = await supabase
    .from('company_add_ons')
    .select(`
      quantity,
      add_ons!inner(name)
    `)
    .eq('company_id', company_id)
    .eq('status', 'ACTIVE');

  let seatsFromAddons = 0;
  (addOns || []).forEach((addOn: any) => {
    if (addOn.add_ons?.name?.toLowerCase().includes('seat') || 
        addOn.add_ons?.name?.toLowerCase().includes('user')) {
      seatsFromAddons += addOn.quantity || 0;
    }
  });

  const maxSeats = seatsFromPlan + seatsFromAddons;

  // Count active seats
  const { count: usedSeats } = await supabase
    .from('seats')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', company_id)
    .eq('active', true);

  return {
    max_seats: maxSeats,
    used_seats: usedSeats || 0,
    available_seats: Math.max(0, maxSeats - (usedSeats || 0)),
    seats_from_plan: seatsFromPlan,
    seats_from_addons: seatsFromAddons,
  };
}

/**
 * Check if a new seat can be created
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
    // Log seat limit reached to audit_logs (non-blocking)
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
