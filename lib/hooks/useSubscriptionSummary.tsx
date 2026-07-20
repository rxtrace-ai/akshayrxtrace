'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export type CanonicalDecisionCode =
  | 'TRIAL_EXPIRED'
  | 'NO_ACTIVE_SUBSCRIPTION'
  | 'QUOTA_EXHAUSTED'
  | null;

export type SubscriptionSummaryResponse = {
  success: boolean;
  company?: {
    id: string;
    name: string | null;
  };
  company_profile?: {
    id: string;
    company_name?: string | null;
    phone?: string | null;
    address?: string | null;
    pan?: string | null;
    gst_number?: string | null;
  } | null;
  subscriptionStatus?: {
    status: "active" | "pending" | "expired" | "cancelled";
    source?: "trial" | "subscription" | null;
    rawStatus?: "active" | "pending" | "expired" | "cancelled" | null;
    paidThroughPeriodEnd?: boolean;
    accessEndsAt?: string | null;
    trialExpiresAt: string | null;
  };
  trial?: {
    active: boolean;
    expires_at: string | null;
    days_remaining: number;
  };
  subscription: null | {
    status: string | null;
    cancel_at_period_end: boolean;
    current_period_start: string | null;
    current_period_end: string | null;
    next_billing_at: string | null;
    start_date?: string | null;
    renewal_date?: string | null;
    plan_name: string | null;
    billing_cycle: string | null;
    plan_price_paise?: number;
  };
  quota_table?: Array<{
    metric: string;
    allocated: number;
    subscription_allocated: number;
    addon_allocated: number;
    consumed: number;
    remaining: number;
  }>;
  capacity_table?: Array<{
    metric: string;
    allocated: number;
    subscription_allocated: number;
    addon_allocated: number;
    consumed: number;
    remaining: number;
  }>;
  capacity_addons?: Array<{
    addon_id: string;
    name: string | null;
    entitlement_key: string | null;
    quantity: number;
    status: string;
  }>;
  add_on_balances?: Record<string, number>;
  invoices?: Array<{
    id: string;
    invoice_type: string;
    invoice_label?: string;
    status: string;
    reference: string | null;
    plan: string | null;
    amount: number;
    currency: string | null;
    period_start: string | null;
    period_end: string | null;
    due_at?: string | null;
    issued_at: string | null;
    paid_at: string | null;
    invoice_pdf_url: string | null;
    created_at: string | null;
  }>;
  subscription_invoices?: Array<{
    id: string;
    invoice_type: string;
    invoice_label?: string;
    status: string;
    reference: string | null;
    plan: string | null;
    amount: number;
    currency: string | null;
    period_start: string | null;
    period_end: string | null;
    due_at?: string | null;
    issued_at: string | null;
    paid_at: string | null;
    invoice_pdf_url: string | null;
    created_at: string | null;
  }>;
  addon_invoices?: Array<{
    id: string;
    invoice_type: string;
    invoice_label?: string;
    status: string;
    reference: string | null;
    plan: string | null;
    amount: number;
    currency: string | null;
    period_start: string | null;
    period_end: string | null;
    due_at?: string | null;
    issued_at: string | null;
    paid_at: string | null;
    invoice_pdf_url: string | null;
    created_at: string | null;
  }>;
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

type SummaryView = 'full' | 'dashboard' | 'settings';

type UseSubscriptionSummaryOptions = {
  view?: SummaryView;
  ttlMs?: number;
  enabled?: boolean;
};

type CacheEntry = {
  data: SubscriptionSummaryResponse | null;
  error: string | null;
  updatedAt: number;
  inflight: Promise<SubscriptionSummaryResponse> | null;
};

const DEFAULT_TTL_MS = 10_000;
const cacheByView = new Map<SummaryView, CacheEntry>();

function getUrl(view: SummaryView) {
  return view === 'full'
    ? '/api/user/subscription/summary'
    : `/api/user/subscription/summary?view=${view}`;
}

async function fetchSummary(view: SummaryView): Promise<SubscriptionSummaryResponse> {
  const res = await fetch(getUrl(view), { cache: 'no-store' });
  const payload = (await res.json()) as SubscriptionSummaryResponse;
  if (!res.ok || !payload.success) {
    throw new Error((payload as any).error || 'Failed to load subscription summary');
  }
  return payload;
}

function getCache(view: SummaryView): CacheEntry {
  const existing = cacheByView.get(view);
  if (existing) return existing;
  const initial: CacheEntry = { data: null, error: null, updatedAt: 0, inflight: null };
  cacheByView.set(view, initial);
  return initial;
}

function isFresh(entry: CacheEntry, ttlMs: number) {
  return entry.updatedAt > 0 && Date.now() - entry.updatedAt < ttlMs;
}

export function useSubscriptionSummary(options?: UseSubscriptionSummaryOptions) {
  const view = options?.view ?? 'full';
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const enabled = options?.enabled ?? true;

  const initial = useMemo(() => getCache(view), [view]);
  const [data, setData] = useState<SubscriptionSummaryResponse | null>(initial.data);
  const [loading, setLoading] = useState<boolean>(enabled ? !initial.data : false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (opts?: { force?: boolean; background?: boolean }) => {
    if (!enabled) return;
    const force = opts?.force ?? false;
    const background = opts?.background ?? false;
    const entry = getCache(view);

    if (!force && isFresh(entry, ttlMs) && entry.data) {
      setData(entry.data);
      setError(entry.error);
      setLoading(false);
      return;
    }

    if (entry.inflight) {
      if (!background) setLoading(true);
      try {
        const payload = await entry.inflight;
        setData(payload);
        setError(null);
      } catch (err: any) {
        setData(entry.data);
        setError(err?.message || 'Failed to load subscription summary');
      } finally {
        if (!background) setLoading(false);
      }
      return;
    }

    if (!background) {
      setLoading(!entry.data || force);
    }
    setError(null);

    const inflight = fetchSummary(view);
    entry.inflight = inflight;

    try {
      const payload = await inflight;
      entry.data = payload;
      entry.error = null;
      entry.updatedAt = Date.now();
      setData(payload);
      setError(null);
    } catch (err: any) {
      const message = err?.message || 'Failed to load subscription summary';
      entry.error = message;
      setData(entry.data);
      setError(message);
    } finally {
      entry.inflight = null;
      if (!background) setLoading(false);
    }
  }, [enabled, ttlMs, view]);

  useEffect(() => {
    if (!enabled) return;
    const entry = getCache(view);
    if (entry.data) {
      setData(entry.data);
      setError(entry.error);
      setLoading(false);
      if (!isFresh(entry, ttlMs)) {
        refresh({ background: true }).catch(() => undefined);
      }
      return;
    }
    refresh({ force: true }).catch(() => undefined);
  }, [enabled, refresh, ttlMs, view]);

  return { data, loading, error, refresh };
}
