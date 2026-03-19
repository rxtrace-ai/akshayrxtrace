'use client';

import Link from 'next/link';
import { useSubscriptionSummary } from '@/lib/hooks/useSubscriptionSummary';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Settings } from 'lucide-react';

export function DashboardTrialCard() {
  const { data, loading } = useSubscriptionSummary();
  if (loading) return null;

  const hasActiveSubscription =
    data?.subscriptionStatus?.status === 'active' ||
    data?.subscription?.status === 'active';
  const isTrial = !hasActiveSubscription && Boolean(data?.entitlement?.trial_active);
  const daysLeft = data?.entitlement?.trial_expires_at
    ? Math.max(0, Math.ceil((new Date(data.entitlement.trial_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  if (isTrial) {
    return (
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge className="bg-green-600 text-white">Trial Active</Badge>
              <span className="text-lg font-bold text-gray-900">{daysLeft} days left</span>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/settings"><Settings className="w-4 h-4 mr-2" />Manage Trial</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-blue-600" />Upgrade to continue
      </h3>
      <Button asChild className="bg-blue-600 hover:bg-blue-700">
        <Link href="/dashboard/subscription"><Settings className="w-4 h-4 mr-2" />View Plans</Link>
      </Button>
    </div>
  );
}
