'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { QrCode, Boxes, Smartphone, Activity } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSubscriptionSummary } from '@/lib/hooks/useSubscriptionSummary';

type DashboardStats = {
  company_id: string;
  company_name: string | null;
  total_skus: number;
  units_generated: number;
  sscc_generated: number;
  total_scans: number;
  active_seats?: number;
  active_handsets: number;
  label_generation?: {
    unit: number;
    box: number;
    carton: number;
    pallet: number;
  };
  recent_activity?: Array<{
    id: string;
    action: string;
    status: string;
    details?: any;
    metadata?: any;
    created_at: string;
  }>;
};

const LabelGenerationTrend = dynamic(
  () => import('@/components/charts/LabelGenerationTrend').then((m) => m.LabelGenerationTrend),
  {
    ssr: false,
    loading: () => <div className="h-48 animate-pulse rounded-md bg-gray-100" />,
  }
);
const LabelsByLevel = dynamic(
  () => import('@/components/charts/LabelsByLevel').then((m) => m.LabelsByLevel),
  {
    ssr: false,
    loading: () => <div className="h-48 animate-pulse rounded-md bg-gray-100" />,
  }
);
const CostUsageChart = dynamic(
  () => import('@/components/charts/CostUsageChart').then((m) => m.CostUsageChart),
  {
    ssr: false,
    loading: () => <div className="h-48 animate-pulse rounded-md bg-gray-100" />,
  }
);

function KpiCard({
  title,
  value,
  icon: Icon,
  href,
  loading,
}: {
  title: string;
  value: string;
  icon: LucideIcon;
  href?: string;
  loading?: boolean;
}) {
  const content = (
    <div className="cursor-pointer rounded-lg border bg-white p-4 transition hover:shadow-md">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          {loading ? (
            <div className="mt-2 h-8 w-20 animate-pulse rounded bg-gray-100" />
          ) : (
            <p className="mt-1 text-2xl font-semibold text-blue-700">{value}</p>
          )}
        </div>
        <Icon className="h-6 w-6 text-blue-600" />
      </div>
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-gray-100" />
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [recentActivity, setRecentActivity] = useState<NonNullable<DashboardStats['recent_activity']>>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const router = useRouter();
  const { data: subscriptionSummary, loading: summaryLoading } = useSubscriptionSummary({
    view: 'dashboard',
  });

  const refreshCoreStats = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch('/api/dashboard/stats?scope=core', { cache: 'no-store', signal });
    const body = await res.json().catch(() => null);
    if (res.ok && body) {
      setStats((prev) => ({ ...prev, ...(body as DashboardStats) }));
    }
  }, []);

  const refreshActivity = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch('/api/dashboard/stats?scope=activity', { cache: 'no-store', signal });
    const body = await res.json().catch(() => null);
    if (res.ok && body) {
      setRecentActivity((body as DashboardStats).recent_activity ?? []);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    (async () => {
      try {
        await Promise.all([
          refreshCoreStats(controller.signal),
          refreshActivity(controller.signal),
        ]);
      } finally {
        if (mounted) {
          setStatsLoading(false);
          setActivityLoading(false);
        }
      }
    })();

    const statsInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshCoreStats(controller.signal).catch(() => undefined);
      }
    }, 15_000);

    const activityInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshActivity(controller.signal).catch(() => undefined);
      }
    }, 30_000);

    return () => {
      mounted = false;
      window.clearInterval(statsInterval);
      window.clearInterval(activityInterval);
      if (!controller.signal.aborted) {
        controller.abort();
      }
    };
  }, [refreshActivity, refreshCoreStats]);

  const kpi = useMemo(() => {
    const dash = (n: number | null | undefined) =>
      typeof n === 'number' ? n.toLocaleString('en-IN') : '-';
    const labelGen = stats?.label_generation;

    return {
      totalSkus: stats ? dash(stats.total_skus) : '0',
      unitsGenerated: stats ? dash(stats.units_generated) : '0',
      ssccGenerated: stats ? dash(stats.sscc_generated) : '0',
      totalScans: stats ? dash(stats.total_scans) : '0',
      activeHandsets: stats ? dash(stats.active_handsets) : '0',
      activeSeats: stats ? dash(stats.active_seats ?? 0) : '0',
      unitLabels: labelGen ? dash(labelGen.unit) : '0',
      boxLabels: labelGen ? dash(labelGen.box) : '0',
      cartonLabels: labelGen ? dash(labelGen.carton) : '0',
      palletLabels: labelGen ? dash(labelGen.pallet) : '0',
    };
  }, [stats]);

  const trialStatusLabel = subscriptionSummary?.entitlement?.trial_active
    ? 'TRIAL_ACTIVE'
    : subscriptionSummary?.entitlement?.trial_expires_at
      ? 'TRIAL_EXPIRED'
      : 'NOT_STARTED';

  const tooltipText = subscriptionSummary?.entitlement?.trial_active
    ? 'Trial active'
    : subscriptionSummary?.entitlement?.trial_expires_at
      ? 'Trial expired'
      : 'Trial not started';

  const assemblyAllowed = !(subscriptionSummary?.decisions?.generation?.blocked ?? false);
  const generationBlockCode = subscriptionSummary?.decisions?.generation?.code ?? null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-blue-700">Dashboard Overview</h1>
        <p className="mt-1 text-gray-600">Quick snapshot of your traceability activity</p>
      </div>

      <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-wide text-gray-500">Trial status</p>
            <h2 className="text-xl font-semibold text-gray-900">
              {subscriptionSummary
                ? subscriptionSummary.entitlement.trial_active
                  ? 'Trial is active'
                  : 'Trial window'
                : 'Loading trial status...'}
            </h2>
          </div>
          <div>
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                subscriptionSummary?.entitlement?.trial_active
                  ? 'bg-emerald-100 text-emerald-800'
                  : subscriptionSummary?.entitlement?.trial_expires_at
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-gray-100 text-gray-700'
              }`}
            >
              {subscriptionSummary ? trialStatusLabel.replace('_', ' ') : 'Loading'}
            </span>
          </div>
        </div>

        <p className="text-sm text-gray-600">
          {subscriptionSummary
            ? tooltipText
            : summaryLoading
              ? 'Loading trial details...'
              : 'Trial data unavailable.'}
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {summaryLoading && !subscriptionSummary ? (
            <>
              <div className="rounded-xl border border-dashed border-gray-200 px-4 py-3">
                <SectionSkeleton rows={2} />
              </div>
              <div className="rounded-xl border border-dashed border-gray-200 px-4 py-3">
                <SectionSkeleton rows={2} />
              </div>
              <div className="rounded-xl border border-dashed border-gray-200 px-4 py-3">
                <SectionSkeleton rows={2} />
              </div>
            </>
          ) : (
            [
              { key: 'generation', metricKey: 'generation', label: 'Generation' },
              { key: 'seats', metricKey: 'seat', label: 'Seats' },
              { key: 'plants', metricKey: 'plant', label: 'Plants' },
            ].map((item) => {
              const blocked = (subscriptionSummary as any)?.decisions?.[item.key]?.blocked ?? false;
              const reason = (subscriptionSummary as any)?.decisions?.[item.key]?.code ?? null;
              const remaining =
                item.metricKey === 'generation'
                  ? ((subscriptionSummary?.entitlement?.remaining?.unit ?? 0) +
                    (subscriptionSummary?.entitlement?.remaining?.box ?? 0) +
                    (subscriptionSummary?.entitlement?.remaining?.carton ?? 0) +
                    (subscriptionSummary?.entitlement?.remaining?.pallet ?? 0))
                  : (subscriptionSummary?.entitlement?.remaining?.[item.metricKey] ?? 0);
              const statusLabel = blocked ? reason || 'Blocked' : 'Allowed';
              const statusColor = blocked ? 'text-rose-600' : 'text-emerald-600';

              return (
                <div
                  key={item.key}
                  className="rounded-xl border border-dashed border-gray-200 px-4 py-3"
                >
                  <p className="text-xs uppercase tracking-wide text-gray-500">{item.label}</p>
                  <p className={`text-sm font-semibold ${statusColor}`}>{statusLabel}</p>
                  <p className="text-xs text-gray-500">{remaining} remaining</p>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <KpiCard title="Total SKUs" value={kpi.totalSkus} icon={QrCode} href="/dashboard/sku" loading={statsLoading} />
        <KpiCard title="Units Generated" value={kpi.unitsGenerated} icon={QrCode} loading={statsLoading} />
        <KpiCard title="SSCC Generated" value={kpi.ssccGenerated} icon={Boxes} loading={statsLoading} />
        <KpiCard title="Total Scans" value={kpi.totalScans} icon={Activity} href="/dashboard/scans" loading={statsLoading} />
        <KpiCard title="Active Seats" value={kpi.activeSeats} icon={Activity} href="/dashboard/seats" loading={statsLoading} />
        <KpiCard title="Active Handsets" value={kpi.activeHandsets} icon={Smartphone} loading={statsLoading} />
      </div>

      <div>
        <h2 className="text-lg font-semibold text-slate-900">Label Generation (Realtime)</h2>
        <p className="mt-1 text-sm text-gray-600">Shows labels generated in the current trial period.</p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard title="Unit Labels" value={kpi.unitLabels} icon={QrCode} loading={statsLoading} />
          <KpiCard title="Box Labels" value={kpi.boxLabels} icon={Boxes} loading={statsLoading} />
          <KpiCard title="Carton Labels" value={kpi.cartonLabels} icon={Boxes} loading={statsLoading} />
          <KpiCard title="Pallet Labels" value={kpi.palletLabels} icon={Boxes} loading={statsLoading} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="h-64 rounded-lg border bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Label Generation Trend</h3>
          <LabelGenerationTrend
            data={[
              {
                date: '5 days ago',
                unit: stats?.label_generation?.unit ?? 0,
                box: stats?.label_generation?.box ?? 0,
                carton: stats?.label_generation?.carton ?? 0,
                pallet: stats?.label_generation?.pallet ?? 0,
              },
            ]}
          />
        </div>

        <div className="h-64 rounded-lg border bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Labels by Level</h3>
          <LabelsByLevel
            data={{
              unit: stats?.label_generation?.unit ?? 0,
              box: stats?.label_generation?.box ?? 0,
              carton: stats?.label_generation?.carton ?? 0,
              pallet: stats?.label_generation?.pallet ?? 0,
            }}
          />
        </div>

        <div className="h-64 rounded-lg border bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Cost Usage Distribution</h3>
          <CostUsageChart
            data={{
              unit: stats?.label_generation?.unit ?? 0,
              box: stats?.label_generation?.box ?? 0,
              carton: stats?.label_generation?.carton ?? 0,
              pallet: stats?.label_generation?.pallet ?? 0,
            }}
          />
        </div>
      </div>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Recent Activity</h2>

        {activityLoading ? (
          <SectionSkeleton rows={4} />
        ) : recentActivity && recentActivity.length > 0 ? (
          <ul className="space-y-3 text-sm text-gray-600">
            {recentActivity.map((activity) => (
              <li key={activity.id} className="flex items-start gap-2">
                <span
                  className={
                    activity.status === 'success'
                      ? 'text-green-500'
                      : activity.status === 'error'
                        ? 'text-red-500'
                        : 'text-yellow-500'
                  }
                >
                  {activity.status === 'success' ? '[ok]' : activity.status === 'error' ? '[x]' : '[!]'}
                </span>
                <div className="flex-1">
                  <span className="font-medium">{activity.action.replace(/_/g, ' ')}</span>
                  {activity.details?.description || activity.metadata?.description ? (
                    <span className="text-gray-500"> - {activity.details?.description ?? activity.metadata?.description}</span>
                  ) : null}
                  <span className="ml-2 text-xs text-gray-400">
                    {new Date(activity.created_at).toLocaleString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No recent activity to display.</p>
        )}
      </div>

      <div className="flex flex-col items-center justify-between gap-6 rounded-xl border bg-gradient-to-r from-blue-50 to-white p-8 md:flex-row">
        <div>
          <h3 className="text-2xl font-bold text-blue-700">Ready to generate labels?</h3>
          <p className="mt-1 text-gray-600">Start generating GS1-compliant QR and DataMatrix codes</p>
        </div>

        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            disabled={!assemblyAllowed || summaryLoading}
            onClick={() => router.push('/dashboard/generate')}
            className={`rounded-lg px-8 py-4 text-lg font-medium text-white transition ${
              (!assemblyAllowed && !summaryLoading) || summaryLoading
                ? 'cursor-not-allowed bg-orange-300'
                : 'bg-orange-500 hover:bg-orange-600'
            }`}
          >
            Generate Labels
          </button>
          {!assemblyAllowed && subscriptionSummary ? (
            <p className="text-xs text-rose-700">
              Generation locked: {generationBlockCode || 'blocked'}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
