import type { SupabaseClient } from '@supabase/supabase-js';
import { getCompanyEntitlementSnapshot } from '@/lib/entitlement/canonical';

export type SeatEntitlementReason = 'quota_exceeded' | null;

export type SeatEntitlement = {
  allocated: number;
  active: number;
  remaining: number;
  blocked: boolean;
  reason: SeatEntitlementReason;
};

function normalizeSnapshot(snapshot: any): SeatEntitlement {
  const allocated = Math.max(0, Number(snapshot?.limits?.seat ?? 0));
  const active = Math.max(0, Number(snapshot?.usage?.seat ?? 0));
  const remaining = Math.max(0, Number(snapshot?.remaining?.seat ?? 0));
  const blocked = snapshot?.state === 'NO_ACTIVE_SUBSCRIPTION' || remaining <= 0;

  return {
    allocated,
    active,
    remaining,
    blocked,
    reason: blocked ? 'quota_exceeded' : null,
  };
}

export async function getSeatEntitlement(
  supabase: SupabaseClient,
  companyId: string
): Promise<SeatEntitlement> {
  const snapshot = await getCompanyEntitlementSnapshot(
    supabase,
    companyId,
    new Date().toISOString()
  );
  return normalizeSnapshot(snapshot);
}
