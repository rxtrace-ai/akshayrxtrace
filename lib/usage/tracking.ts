import { SupabaseClient } from '@supabase/supabase-js';

export type MetricType = 'UNIT' | 'BOX' | 'CARTON' | 'SSCC' | 'API';
export type UsageSource = 'ui' | 'csv' | 'api';

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
    // Note: Aggregation happens automatically via trigger
  } catch (err) {
    console.error('Failed to track usage:', err);
    // Don't throw - usage tracking should not break generation
  }
}

/**
 * Get current period usage for a company
 */
export async function getCurrentUsage(
  supabase: SupabaseClient,
  company_id: string,
  metric_type?: MetricType
): Promise<Record<string, number>> {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let query = supabase
    .from('usage_counters')
    .select('metric_type, used_quantity')
    .eq('company_id', company_id)
    .eq('period_start', periodStart.toISOString().split('T')[0]);

  if (metric_type) {
    query = query.eq('metric_type', metric_type);
  }

  const { data } = await query;

  const usage: Record<string, number> = {};
  (data || []).forEach((row: any) => {
    usage[row.metric_type] = row.used_quantity || 0;
  });

  return usage;
}

/**
 * Get usage limits for a company's subscription plan
 */
export async function getUsageLimits(
  supabase: SupabaseClient,
  company_id: string
): Promise<Record<string, { limit_value: number | null; limit_type: 'HARD' | 'SOFT' | 'NONE' }>> {
  // Get company's subscription
  const { data: subscription } = await supabase
    .from('company_subscriptions')
    .select('plan_id')
    .eq('company_id', company_id)
    .eq('status', 'ACTIVE')
    .maybeSingle();

  if (!subscription?.plan_id) {
    return {};
  }

  // Get plan items with limits
  const { data: planItems } = await supabase
    .from('plan_items')
    .select('label, limit_value, limit_type')
    .eq('plan_id', subscription.plan_id)
    .not('limit_value', 'is', null);

  const limits: Record<string, { limit_value: number | null; limit_type: 'HARD' | 'SOFT' | 'NONE' }> = {};

  (planItems || []).forEach((item: any) => {
    // Map label to metric type (e.g., "Unit labels" -> "UNIT")
    const metricType = mapLabelToMetricType(item.label);
    if (metricType) {
      limits[metricType] = {
        limit_value: item.limit_value,
        limit_type: item.limit_type || 'NONE',
      };
    }
  });

  return limits;
}

/**
 * PRIORITY-2: Quota Type → Code Generation Mapping
 * 
 * SINGLE SOURCE OF TRUTH:
 * - Quota limits: plan_items table (admin-editable)
 * - Quota usage (billing): billing_usage table (current billing period)
 * - Quota usage (analytics): usage_counters table (monthly aggregates)
 * 
 * QUOTA TYPE MAPPING:
 * - UNIT → Unit label generation API (/api/unit/create/route.ts)
 * - BOX → Box-level SSCC generation (/api/sscc/generate/route.ts, when generate_box=true)
 * - CARTON → Carton-level SSCC generation (/api/sscc/generate/route.ts, when generate_carton=true)
 * - PALLET → Pallet-level SSCC generation (/api/sscc/generate/route.ts, when generate_pallet=true)
 * - SSCC → Consolidated SSCC usage (all SSCC levels combined, consumed by /api/sscc/generate/route.ts)
 * 
 * Note: SSCC quota is consolidated - all levels (Box, Carton, Pallet) consume the same SSCC quota pool.
 */
function mapLabelToMetricType(label: string): MetricType | null {
  const normalized = label.toLowerCase();
  if (normalized.includes('unit')) return 'UNIT';
  if (normalized.includes('box')) return 'BOX';
  if (normalized.includes('carton')) return 'CARTON';
  if (normalized.includes('pallet') || normalized.includes('sscc')) return 'SSCC';
  return null;
}

/**
 * Check if usage exceeds limits
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

  if (!limit || limit.limit_type === 'NONE' || limit.limit_value === null) {
    return {
      allowed: true,
      current_usage: currentUsage,
      limit_value: null,
      limit_type: 'NONE',
    };
  }

  const newUsage = currentUsage + requested_quantity;
  const exceedsLimit = newUsage > limit.limit_value;

  // Log limit crossing to audit_logs (non-blocking)
  if (exceedsLimit) {
    supabase.from('audit_logs').insert({
      action: limit.limit_type === 'HARD' ? 'USAGE_HARD_LIMIT_EXCEEDED' : 'USAGE_SOFT_LIMIT_EXCEEDED',
      company_id,
      metadata: {
        metric_type,
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

  if (limit.limit_type === 'HARD' && exceedsLimit) {
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
    reason: exceedsLimit ? `Soft limit exceeded. Current: ${currentUsage}, Limit: ${limit.limit_value}` : undefined,
  };
}
