import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { normalizePlanType, quotasForPlan, resolvePaidPeriod } from '@/lib/billing/period';
import type { PlanType } from '@/lib/billingConfig';
import { clearTrialWindowIfConverted } from '@/lib/trial';

export type ActiveUsageRow = {
  id: string;
  company_id: string;
  billing_period_start: string;
  billing_period_end: string;
  plan: string;
  unit_labels_quota: number;
  box_labels_quota: number;
  carton_labels_quota: number;
  pallet_labels_quota: number;
  sscc_labels_quota?: number; // Consolidated SSCC quota
  user_seats_quota: number;
  unit_labels_used: number;
  box_labels_used: number;
  carton_labels_used: number;
  pallet_labels_used: number;
  sscc_labels_used?: number; // Consolidated SSCC usage
  user_seats_used: number;
};

export async function getCompanyBillingContext(opts: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  companyId: string;
}) {
  const { supabase, companyId } = opts;

  const { data: companyRow, error } = await supabase
    .from('companies')
    .select('id, subscription_status, subscription_plan, trial_started_at, trial_expires_at, extra_user_seats')
    .eq('id', companyId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!companyRow) throw new Error('Company not found');

  const planRaw = (companyRow as any).subscription_plan;
  const planType = normalizePlanType(planRaw);

  return {
    company: companyRow as any,
    planType,
  } as {
    company: any;
    planType: PlanType | null;
  };
}

export async function ensureActiveBillingUsage(opts: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  companyId: string;
  now?: Date;
}): Promise<ActiveUsageRow | null> {
  const { supabase, companyId } = opts;
  const now = opts.now ?? new Date();

  // 1) Try find active row
  const { data: active, error: activeErr } = await supabase
    .from('billing_usage')
    .select('*')
    .eq('company_id', companyId)
    .lte('billing_period_start', now.toISOString())
    .gt('billing_period_end', now.toISOString())
    .order('billing_period_start', { ascending: false })
    .limit(1);

  if (activeErr) throw new Error(activeErr.message);
  if (active && active.length > 0) return active[0] as any;

  // 2) Create one based on company status/plan
  const { company, planType } = await getCompanyBillingContext({ supabase, companyId });
  if (!planType) return null;

  const status = String(company.subscription_status ?? '').toLowerCase();
  const trialEndRaw = company.trial_expires_at ? String(company.trial_expires_at) : null;

  let periodStart: Date;
  let periodEnd: Date;

  if (status === 'trial') {
    if (!trialEndRaw) return null;
    periodStart = now;
    periodEnd = new Date(trialEndRaw);
  } else {
    if (!trialEndRaw) return null;
    const paid = resolvePaidPeriod({ trialEnd: new Date(trialEndRaw), now });
    periodStart = paid.start;
    periodEnd = paid.end;
  }

  const quotas = quotasForPlan(planType);
  const planStored = String(company.subscription_plan ?? planType);

  // Calculate consolidated SSCC quota
  const sscc_labels_quota = quotas.box_labels_quota + quotas.carton_labels_quota + quotas.pallet_labels_quota;

  const insertRow = {
    company_id: companyId,
    billing_period_start: periodStart.toISOString(),
    billing_period_end: periodEnd.toISOString(),
    plan: planStored,
    unit_labels_quota: quotas.unit_labels_quota,
    box_labels_quota: quotas.box_labels_quota,
    carton_labels_quota: quotas.carton_labels_quota,
    pallet_labels_quota: quotas.pallet_labels_quota,
    sscc_labels_quota, // Consolidated SSCC quota
    user_seats_quota: quotas.user_seats_quota,
    unit_labels_used: 0,
    box_labels_used: 0,
    carton_labels_used: 0,
    pallet_labels_used: 0,
    sscc_labels_used: 0, // Consolidated SSCC usage
    user_seats_used: quotas.user_seats_quota,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  const { data: created, error: createErr } = await supabase
    .from('billing_usage')
    .upsert(insertRow, { onConflict: 'company_id,billing_period_start' })
    .select('*')
    .single();

  if (createErr) throw new Error(createErr.message);
  return created as any;
}

/** PHASE-3: Dashboard usage shape from billing_usage row */
export type BillingUsageMetric = {
  used: number;
  limit_value: number | null;
  limit_type: 'HARD' | 'SOFT' | 'NONE';
  exceeded: boolean;
  percentage: number;
};

export type BillingUsageDashboard = Record<string, BillingUsageMetric>;

const toNum = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * PHASE-3: Build user-facing usage+limits from an active billing_usage row.
 * limit_type comes from plan_items (passed in); used/limit from the row.
 */
export function billingUsageToDashboard(
  row: ActiveUsageRow,
  limits: Record<string, { limit_value: number | null; limit_type: 'HARD' | 'SOFT' | 'NONE' }>
): BillingUsageDashboard {
  const unitUsed = toNum((row as any).unit_labels_used);
  const boxUsed = toNum((row as any).box_labels_used);
  const cartonUsed = toNum((row as any).carton_labels_used);
  const palletUsed = toNum((row as any).pallet_labels_used);
  const ssccUsed = toNum((row as any).sscc_labels_used) || boxUsed + cartonUsed + palletUsed;
  const unitQuota = toNum((row as any).unit_labels_quota);
  const boxQuota = toNum((row as any).box_labels_quota);
  const cartonQuota = toNum((row as any).carton_labels_quota);
  const palletQuota = toNum((row as any).pallet_labels_quota);
  const ssccQuota = toNum((row as any).sscc_labels_quota) || boxQuota + cartonQuota + palletQuota;

  const quota = (n: number): number | null => (n > 0 ? n : null);

  const mk = (used: number, limit: number | null, key: string): BillingUsageMetric => {
    const limitType = limits[key]?.limit_type ?? 'HARD';
    const limitVal = limit ?? limits[key]?.limit_value ?? null;
    return {
      used,
      limit_value: limitVal,
      limit_type: limitType,
      exceeded: limitVal != null ? used > limitVal : false,
      percentage: limitVal != null && limitVal > 0 ? Math.min(100, Math.round((used / limitVal) * 100)) : 0,
    };
  };

  return {
    UNIT: mk(unitUsed, quota(unitQuota), 'UNIT'),
    BOX: mk(boxUsed, quota(boxQuota), 'BOX'),
    CARTON: mk(cartonUsed, quota(cartonQuota), 'CARTON'),
    SSCC: mk(ssccUsed, quota(ssccQuota), 'SSCC'),
  };
}

export async function assertCompanyCanOperate(opts: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  companyId: string;
}) {
  const { supabase, companyId } = opts;
  const { company } = await getCompanyBillingContext({ supabase, companyId });
  const status = String(company.subscription_status ?? '').toLowerCase();

  if (status === 'past_due') {
    const e: any = new Error('Subscription is past due. Please top-up / settle payment.');
    e.code = 'PAST_DUE';
    throw e;
  }
  if (status === 'cancelled' || status === 'expired') {
    const e: any = new Error('Subscription is not active.');
    e.code = 'SUBSCRIPTION_INACTIVE';
    throw e;
  }

  await clearTrialWindowIfConverted(supabase, companyId, status, company.trial_started_at);
}
