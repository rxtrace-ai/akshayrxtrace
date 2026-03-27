import { SupabaseClient } from '@supabase/supabase-js';
import { getCompanyEntitlementSnapshot, type CanonicalMetric } from '@/lib/entitlement/canonical';

export type MetricType = 'UNIT' | 'BOX' | 'CARTON' | 'SSCC' | 'API';
export type UsageSource = 'ui' | 'csv' | 'api';

type UsageLimit = {
  limit_value: number | null;
  limit_type: 'HARD' | 'SOFT' | 'NONE';
};

function metricTypeToCanonicalMetric(metricType: MetricType): CanonicalMetric | null {
  switch (metricType) {
    case 'UNIT':
      return 'unit';
    case 'BOX':
      return 'box';
    case 'CARTON':
      return 'carton';
    default:
      return null;
  }
}

/**
 * Track usage event (non-blocking, read-only accounting)
 */
export async function trackUsage(
  supabase: SupabaseClient,
  params: {
    company_id: string;
    metric_type: MetricType;
    quantity: number;
    source: UsageSource;
    reference_id?: string;
  }
): Promise<void> {
  try {
    await supabase.from('usage_events').insert({
      company_id: params.company_id,
      metric_type: params.metric_type,
      quantity: params.quantity,
      source: params.source,
      reference_id: params.reference_id || null,
    });
  } catch (err) {
    console.error('Failed to track usage:', err);
  }
}

/**
 * Read current entitlement-window usage using the canonical snapshot.
 * Legacy monthly counters are intentionally not used for enforcement anymore.
 */
export async function getCurrentUsage(
  supabase: SupabaseClient,
  company_id: string,
  metric_type?: MetricType
): Promise<Record<string, number>> {
  const snapshot = await getCompanyEntitlementSnapshot(supabase, company_id);

  const usage: Record<string, number> = {
    UNIT: snapshot.usage.unit ?? 0,
    BOX: snapshot.usage.box ?? 0,
    CARTON: snapshot.usage.carton ?? 0,
    SSCC: snapshot.usage.pallet ?? 0,
    API: 0,
  };

  if (metric_type) {
    return { [metric_type]: usage[metric_type] ?? 0 };
  }

  return usage;
}

/**
 * Legacy compatibility helper.
 * Limits now come from the canonical entitlement snapshot instead of plan_items.
 */
export async function getUsageLimits(
  supabase: SupabaseClient,
  company_id: string
): Promise<Record<string, UsageLimit>> {
  const snapshot = await getCompanyEntitlementSnapshot(supabase, company_id);

  const limits: Record<string, UsageLimit> = {
    UNIT: {
      limit_value: snapshot.limits.unit ?? 0,
      limit_type: 'HARD',
    },
    BOX: {
      limit_value: snapshot.limits.box ?? 0,
      limit_type: 'HARD',
    },
    CARTON: {
      limit_value: snapshot.limits.carton ?? 0,
      limit_type: 'HARD',
    },
    SSCC: {
      limit_value: snapshot.limits.pallet ?? 0,
      limit_type: 'HARD',
    },
    API: {
      limit_value: null,
      limit_type: 'NONE',
    },
  };

  return limits;
}

/**
 * Compatibility wrapper for callers that still expect old limit checks.
 * This now delegates to the canonical entitlement snapshot.
 */
export async function checkUsageLimits(
  supabase: SupabaseClient,
  company_id: string,
  metric_type: MetricType,
  requested_quantity: number
): Promise<{
  allowed: boolean;
  reason?: string;
  current_usage: number;
  limit_value: number | null;
  limit_type: 'HARD' | 'SOFT' | 'NONE';
}> {
  const usage = await getCurrentUsage(supabase, company_id, metric_type);
  const limits = await getUsageLimits(supabase, company_id);

  const currentUsage = usage[metric_type] || 0;
  const limit = limits[metric_type];
  const canonicalMetric = metricTypeToCanonicalMetric(metric_type);

  if (!limit || limit.limit_type === 'NONE' || limit.limit_value === null || !canonicalMetric) {
    return {
      allowed: true,
      current_usage: currentUsage,
      limit_value: limit?.limit_value ?? null,
      limit_type: limit?.limit_type ?? 'NONE',
    };
  }

  const newUsage = currentUsage + requested_quantity;
  const exceedsLimit = newUsage > limit.limit_value;

  if (exceedsLimit) {
    supabase.from('audit_logs').insert({
      action: 'USAGE_HARD_LIMIT_EXCEEDED',
      company_id,
      metadata: {
        metric_type,
        canonical_metric: canonicalMetric,
        current_usage: currentUsage,
        requested_quantity,
        limit_value: limit.limit_value,
        limit_type: limit.limit_type,
      },
    }).then(({ error }) => {
      if (error) {
        console.error('Failed to log limit crossing:', error);
      }
    });
  }

  if (exceedsLimit) {
    return {
      allowed: false,
      reason: `Hard limit exceeded. Current: ${currentUsage}, Limit: ${limit.limit_value}, Requested: ${requested_quantity}`,
      current_usage: currentUsage,
      limit_value: limit.limit_value,
      limit_type: 'HARD',
    };
  }

  return {
    allowed: true,
    current_usage: currentUsage,
    limit_value: limit.limit_value,
    limit_type: limit.limit_type,
  };
}
