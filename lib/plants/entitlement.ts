import type { SupabaseClient } from '@supabase/supabase-js';
import { getCompanyEntitlementSnapshot } from '@/lib/entitlement/canonical';

export type PlantEntitlementReason = 'quota_exceeded' | 'trial_expired' | null;

export type PlantEntitlement = {
  allocated: number;
  active: number;
  remaining: number;
  blocked: boolean;
  reason: PlantEntitlementReason;
};

function normalizeSnapshot(snapshot: any): PlantEntitlement {
  const allocated = Math.max(0, Number(snapshot?.limits?.plant ?? 0));
  const active = Math.max(0, Number(snapshot?.usage?.plant ?? 0));
  const remaining = Math.max(0, Number(snapshot?.remaining?.plant ?? 0));
  const trialExpired = snapshot?.state === 'TRIAL_EXPIRED';
  const blocked = trialExpired || snapshot?.state === 'NO_ACTIVE_SUBSCRIPTION' || remaining <= 0;

  return {
    allocated,
    active,
    remaining,
    blocked,
    reason: trialExpired ? 'trial_expired' : blocked ? 'quota_exceeded' : null,
  };
}

export async function getPlantEntitlement(
  supabase: SupabaseClient,
  companyId: string
): Promise<PlantEntitlement> {
  const snapshot = await getCompanyEntitlementSnapshot(
    supabase,
    companyId,
    new Date().toISOString()
  );
  return normalizeSnapshot(snapshot);
}
