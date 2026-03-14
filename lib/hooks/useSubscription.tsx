'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { TrialDashboardSummary } from '@/lib/trial';

type SubscriptionStatus = 'trialing' | 'expired' | 'cancelled' | null;

type Subscription = {
  status: SubscriptionStatus;
  trial_end: string | null;
};

type SubscriptionData = {
  subscription: Subscription | null;
  trialSummary: TrialDashboardSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  isFeatureEnabled: (feature: string) => boolean;
  canAccess: () => boolean;
};

const SubscriptionContext = createContext<SubscriptionData | null>(null);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [trialSummary, setTrialSummary] = useState<TrialDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscription = async () => {
    try {
      setError(null);
      const res = await fetch('/api/user/dashboard/summary', { credentials: 'include' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `Failed to load trial summary (${res.status})`);
      }

      const payload: TrialDashboardSummary = await res.json();
      setTrialSummary(payload);

      const newStatus: SubscriptionStatus = payload.trial_status === 'cancelled'
        ? 'cancelled'
        : payload.trial_active
        ? 'trialing'
        : payload.trial_expires_at
        ? 'expired'
        : null;

      setSubscription({
        status: newStatus,
        trial_end: payload.trial_expires_at,
      });
    } catch (err: any) {
      console.error('Failed to load trial summary', err);
      setTrialSummary(null);
      setSubscription(null);
      setError(err.message || 'Failed to load trial summary');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubscription();
  }, []);

  const isFeatureEnabled = () => Boolean(trialSummary?.trial_active);
  const canAccess = () => isFeatureEnabled();

  return (
    <SubscriptionContext.Provider
      value={{
        subscription,
        trialSummary,
        loading,
        error,
        refresh: fetchSubscription,
        isFeatureEnabled,
        canAccess,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (!context) throw new Error('useSubscription must be used within SubscriptionProvider');
  return context;
}
