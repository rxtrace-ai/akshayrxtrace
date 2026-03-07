import type { SupabaseClient } from '@supabase/supabase-js';
import type { MetricType } from '@/lib/usage/tracking';

export const TRIAL_CONFIG = {
  duration_days: 10,
  unit_limit: 5000,
  box_limit: 500,
  carton_limit: 100,
  pallet_limit: 25,
  seat_limit: 5,
  plant_limit: 2,
} as const;

export type TrialLimitKey = 'unit' | 'box' | 'carton' | 'pallet' | 'seat' | 'plant';

export type TrialLimits = {
  unit: number;
  box: number;
  carton: number;
  pallet: number;
  seat: number;
  plant: number;
};

export const TRIAL_LIMITS: TrialLimits = {
  unit: TRIAL_CONFIG.unit_limit,
  box: TRIAL_CONFIG.box_limit,
  carton: TRIAL_CONFIG.carton_limit,
  pallet: TRIAL_CONFIG.pallet_limit,
  seat: TRIAL_CONFIG.seat_limit,
  plant: TRIAL_CONFIG.plant_limit,
};

export type TrialUsageTotals = {
  unit: number;
  box: number;
  carton: number;
  pallet: number;
};

export type TrialStatus = {
  active: boolean;
  startedAt: Date | null;
  expiresAt: Date | null;
  daysRemaining: number;
};

type TrialMetricLimitKey = keyof TrialUsageTotals;

const metricToLimitKey: Record<MetricType, TrialMetricLimitKey> = {
  UNIT: 'unit',
  BOX: 'box',
  CARTON: 'carton',
  SSCC: 'pallet',
  API: 'unit',
};

const trialUsageMetrics: Array<keyof TrialUsageTotals> = ['unit', 'box', 'carton', 'pallet'];

export function getTrialStatus(company: {
  trial_started_at?: string | null;
  trial_expires_at?: string | null;
  trial_start_at?: string | null;
  trial_end_at?: string | null;
}): TrialStatus {
  const startedRaw = company.trial_start_at ?? company.trial_started_at ?? null;
  const expiresRaw = company.trial_end_at ?? company.trial_expires_at ?? null;

  const started = startedRaw ? new Date(startedRaw) : null;
  const expires = expiresRaw ? new Date(expiresRaw) : null;
  const now = new Date();

  const active =
    !!started && !!expires && now.getTime() >= started.getTime() && now.getTime() <= expires.getTime();

  const daysRemaining =
    active && expires
      ? Math.max(0, Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

  return {
    active,
    startedAt: started,
    expiresAt: expires,
    daysRemaining,
  };
}

export async function getTrialUsageTotals(
  supabase: SupabaseClient,
  companyId: string,
  trialStartedAt: Date,
  trialEndsAt: Date | null = null
): Promise<TrialUsageTotals> {
  const startsAtIso = trialStartedAt.toISOString();
  const endsAtIso = (trialEndsAt ?? new Date()).toISOString();
  const { data, error } = await supabase.rpc('trial_usage_summary', {
    p_company_id: companyId,
    p_starts_at: startsAtIso,
    p_ends_at: endsAtIso,
  });

  if (error) {
    throw error;
  }

  const totals: TrialUsageTotals = {
    unit: 0,
    box: 0,
    carton: 0,
    pallet: 0,
  };

  (data || []).forEach((row: any) => {
    const metric = row?.metric_type as MetricType | undefined;
    const total = Number(row?.used ?? 0);
    const key = metric ? metricToLimitKey[metric] : null;
    if (key && totals[key] !== undefined) {
      totals[key] += total;
    }
  });

  return totals;
}

export async function getTrialSeatUsage(
  supabase: SupabaseClient,
  companyId: string
): Promise<number> {
  const { count, error } = await supabase
    .from('seats')
    .select('id', { head: true, count: 'exact' })
    .eq('company_id', companyId)
    .eq('active', true);

  if (error) {
    throw error;
  }

  return Number(count || 0);
}

export async function startTrialForCompany(
  supabase: SupabaseClient,
  companyId: string,
  opts?: { force?: boolean; reason?: string; now?: Date }
) {
  // Trials must ONLY be activated by verified Razorpay webhooks.
  // This function is kept to avoid breaking imports in older branches,
  // but it is intentionally disabled.
  void supabase;
  void companyId;
  void opts;
  return {
    ok: false,
    error: 'TRIAL_ACTIVATION_WEBHOOK_ONLY',
    trial: { started_at: null, expires_at: null },
  };
}

export function limitForMetric(metric: MetricType): TrialMetricLimitKey | null {
  return metricToLimitKey[metric] ?? null;
}

export function limitValueForKey(key: TrialLimitKey): number {
  return TRIAL_LIMITS[key];
}

export type TrialEnforcementReason = 'TRIAL_EXPIRED' | 'TRIAL_NOT_STARTED' | 'TRIAL_QUOTA_EXHAUSTED' | null;

export type TrialEnforcementState = {
  allowed: boolean;
  reason: TrialEnforcementReason;
  remaining: number;
};

export type TrialEnforcementSummary = {
  generation: TrialEnforcementState;
  seats: TrialEnforcementState;
  plants: TrialEnforcementState;
};

function baseTrialReason(status: TrialStatus): TrialEnforcementReason {
  if (!status.startedAt) return 'TRIAL_NOT_STARTED';
  if (!status.active) return 'TRIAL_EXPIRED';
  return null;
}

function buildEnforcementState(
  remaining: number,
  baseReason: TrialEnforcementReason
): TrialEnforcementState {
  const allow = baseReason === null && remaining > 0;
  const reason = allow ? null : baseReason ?? 'TRIAL_QUOTA_EXHAUSTED';
  const displayedRemaining = baseReason === 'TRIAL_EXPIRED' ? 0 : remaining;
  return {
    allowed: allow,
    reason,
    remaining: displayedRemaining,
  };
}

export function evaluateTrialEnforcement(params: {
  trialStatus: TrialStatus;
  usageTotals: TrialUsageTotals;
  seatUsage: number;
  plantUsage: number;
}): TrialEnforcementSummary {
  const { trialStatus, usageTotals, seatUsage, plantUsage } = params;
  const statusReason = baseTrialReason(trialStatus);

  const generationRemaining = Math.min(
    ...trialUsageMetrics.map((key) => Math.max(0, TRIAL_LIMITS[key] - (usageTotals[key] ?? 0)))
  );

  const seatRemaining = Math.max(0, TRIAL_LIMITS.seat - seatUsage);
  const plantRemaining = Math.max(0, TRIAL_LIMITS.plant - plantUsage);

  return {
    generation: buildEnforcementState(generationRemaining, statusReason),
    seats: buildEnforcementState(seatRemaining, statusReason),
    plants: buildEnforcementState(plantRemaining, statusReason),
  };
}

export type TrialDashboardSummary = {
  trial_active: boolean;
  trial_expires_at: string | null;
  days_remaining: number;
  limits: TrialLimits;
  usage: TrialUsageTotals & { seat: number; plant: number };
  enforcement: TrialEnforcementSummary;
};

export async function clearTrialWindowIfConverted(
  supabase: SupabaseClient,
  companyId: string,
  status?: string,
  trialStartedAt?: string | null
) {
  const normalizedStatus = (status ?? '').trim().toLowerCase();
  if (!trialStartedAt) return;
  if (['trial', 'trialing', 'trial_active'].includes(normalizedStatus)) return;

  await supabase
    .from('companies')
    .update({
      trial_started_at: null,
      trial_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', companyId);
}
