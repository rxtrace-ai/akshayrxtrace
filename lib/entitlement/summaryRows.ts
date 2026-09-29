import type { CanonicalMetric, EntitlementSnapshot } from "@/lib/entitlement/canonical";

export type EntitlementSummaryRow = {
  metric: CanonicalMetric;
  opening: number;
  used: number;
  remaining: number;
  allocated: number;
  consumed: number;
  subscription_allocated: number;
  addon_allocated: number;
};

const QUOTA_METRICS = ["unit", "box", "carton", "pallet"] as const;
const CAPACITY_METRICS = ["seat", "plant", "handset"] as const;

export function buildQuotaSummaryRows(entitlement: EntitlementSnapshot): EntitlementSummaryRow[] {
  return QUOTA_METRICS.map((metric) => {
    const opening = Math.max(0, Math.trunc(entitlement.limits[metric] ?? 0));
    const used = Math.max(0, Math.trunc(entitlement.usage[metric] ?? 0));
    const addonAllocated = Math.max(0, Math.trunc(entitlement.topups[metric] ?? 0));
    return {
      metric, opening, used, remaining: Math.max(opening - used, 0),
      allocated: opening, consumed: used,
      subscription_allocated: Math.max(0, opening - addonAllocated), addon_allocated: addonAllocated,
    };
  });
}

export function buildCapacitySummaryRows(
  entitlement: EntitlementSnapshot,
  addonCapacity: Record<(typeof CAPACITY_METRICS)[number], number>,
): EntitlementSummaryRow[] {
  return CAPACITY_METRICS.map((metric) => {
    const opening = Math.max(0, Math.trunc(entitlement.limits[metric] ?? 0));
    const used = Math.max(0, Math.trunc(entitlement.usage[metric] ?? 0));
    const addonAllocated = Math.max(0, Math.trunc(addonCapacity[metric] ?? 0));
    return {
      metric, opening, used, remaining: Math.max(0, opening - used),
      allocated: opening, consumed: used,
      subscription_allocated: Math.max(0, opening - addonAllocated), addon_allocated: addonAllocated,
    };
  });
}
