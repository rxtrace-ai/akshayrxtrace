'use client';

import { useEffect, useState } from 'react';

export type CanonicalDecisionCode =
  | 'TRIAL_EXPIRED'
  | 'NO_ACTIVE_SUBSCRIPTION'
  | 'QUOTA_EXHAUSTED'
  | null;

export type SubscriptionSummaryResponse = {
  success: boolean;
  subscription: null | {
    status: string | null;
    cancel_at_period_end: boolean;
    current_period_start: string | null;
    current_period_end: string | null;
    next_billing_at: string | null;
    plan_name: string | null;
    billing_cycle: string | null;
    amount_paise: number;
  };
  entitlement: {
    state: string;
    trial_active: boolean;
    trial_expires_at: string | null;
    period_start: string | null;
    period_end: string | null;
    limits: Record<string, number>;
    usage: Record<string, number>;
    remaining: Record<string, number>;
    topups: Record<string, number>;
    blocked: boolean;
  };
  decisions?: {
    generation?: { blocked: boolean; code: CanonicalDecisionCode };
    seats?: { blocked: boolean; code: CanonicalDecisionCode };
    plants?: { blocked: boolean; code: CanonicalDecisionCode };
  };
};

export function useSubscriptionSummary() {
  const [data, setData] = useState<SubscriptionSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/user/subscription/summary', { cache: 'no-store' });
      const payload = (await res.json()) as SubscriptionSummaryResponse;
      if (!res.ok || !payload.success) {
        throw new Error((payload as any).error || 'Failed to load subscription summary');
      }
      setData(payload);
    } catch (err: any) {
      setData(null);
      setError(err?.message || 'Failed to load subscription summary');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, loading, error, refresh };
}

