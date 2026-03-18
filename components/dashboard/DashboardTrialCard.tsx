'use client';

import Link from 'next/link';
import { useSubscription } from '@/lib/hooks/useSubscription';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Settings } from 'lucide-react';

export function DashboardTrialCard() {
  const { subscription, loading } = useSubscription();
  if (loading) return null;

  const isTrial = subscription?.status === 'trialing';
  const daysLeft = subscription?.trial_end
    ? Math.max(0, Math.ceil((new Date(subscription.trial_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
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
        <Sparkles className="w-5 h-5 text-blue-600" />Get started with RxTrace
      </h3>
      <Button asChild className="bg-blue-600 hover:bg-blue-700">
        <Link href="/dashboard/settings"><Settings className="w-4 h-4 mr-2" />Start Free Trial</Link>
      </Button>
    </div>
  );
}
