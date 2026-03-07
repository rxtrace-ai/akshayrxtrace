'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  QrCode,
  Boxes,
  Wallet,
  Smartphone,
  Activity,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { LabelGenerationTrend } from '@/components/charts/LabelGenerationTrend';
import { LabelsByLevel } from '@/components/charts/LabelsByLevel';
import { CostUsageChart } from '@/components/charts/CostUsageChart';
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
  wallet: {
    balance: number;
    credit_limit: number;
    status: string;
    updated_at: string | null;
  };
  recent_activity?: Array<{
    id: string;
    action: string;
    status: string;
    details: any;
    created_at: string;
  }>;
  trial?: any | null;
};

/* -----------------------------
   Small reusable KPI card
------------------------------ */
function KpiCard({
  title,
  value,
  icon: Icon,
  href,
}: {
  title: string;
  value: string;
  icon: LucideIcon;
  href?: string;
}) {
  const content = (
    <div className="bg-white border rounded-lg p-4 hover:shadow-md transition cursor-pointer">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-2xl font-semibold text-blue-700 mt-1">
            {value}
          </p>
        </div>
        <Icon className="w-6 h-6 text-blue-600" />
      </div>
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

/* -----------------------------
   Dashboard Page
------------------------------ */
export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const router = useRouter();
  const { data: subscriptionSummary, loading: summaryLoading } = useSubscriptionSummary();

  async function refreshStats(signal?: AbortSignal) {
    const res = await fetch('/api/dashboard/stats', { cache: 'no-store', signal });
    const body = await res.json().catch(() => null);
    if (res.ok) setStats(body as DashboardStats);
  }

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    (async () => {
      try {
        await Promise.all([refreshStats(controller.signal)]);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();

    // Near-realtime dashboard counters.
      const id = window.setInterval(() => {
        refreshStats(controller.signal).catch(() => undefined);
      }, 5000);

    return () => {
      mounted = false;
      window.clearInterval(id);
      if (!controller.signal.aborted) {
        try {
          controller.abort();
        } catch {
          // Ignore abort errors during cleanup
        }
      }
    };
  }, []);

  const kpi = useMemo(() => {
    const dash = (n: number | null | undefined) => (typeof n === 'number' ? n.toLocaleString('en-IN') : '—');
    const rupee = (n: number | null | undefined) => (typeof n === 'number' ? `₹${Math.round(n).toLocaleString('en-IN')}` : '—');

    const labelGen = stats?.label_generation;

    return {
      totalSkus: stats ? dash(stats.total_skus) : (loading ? '—' : '0'),
      unitsGenerated: stats ? dash(stats.units_generated) : (loading ? '—' : '0'),
      ssccGenerated: stats ? dash(stats.sscc_generated) : (loading ? '—' : '0'),
      totalScans: stats ? dash(stats.total_scans) : (loading ? '—' : '0'),
      walletBalance: stats ? rupee(stats.wallet?.balance) : (loading ? '—' : '₹0'),
      activeHandsets: stats ? dash(stats.active_handsets) : (loading ? '—' : '0'),
      activeSeats: stats ? dash(stats.active_seats ?? 0) : (loading ? '—' : '0'),

      unitLabels: labelGen ? dash(labelGen.unit) : (loading ? '—' : '0'),
      boxLabels: labelGen ? dash(labelGen.box) : (loading ? '—' : '0'),
      cartonLabels: labelGen ? dash(labelGen.carton) : (loading ? '—' : '0'),
      palletLabels: labelGen ? dash(labelGen.pallet) : (loading ? '—' : '0'),
    };
  }, [stats, loading]);

  const trialStatusLabel = subscriptionSummary?.entitlement?.trial_active
    ? 'TRIAL_ACTIVE'
    : subscriptionSummary?.entitlement?.trial_expires_at
    ? 'TRIAL_EXPIRED'
    : 'NOT_STARTED';

  const tooltipText = subscriptionSummary?.entitlement?.trial_active
    ? `Trial active`
    : subscriptionSummary?.entitlement?.trial_expires_at
    ? 'Trial expired'
    : 'Trial not started';

  const assemblyAllowed = !(subscriptionSummary?.decisions?.generation?.blocked ?? false);
  const generationBlockCode = subscriptionSummary?.decisions?.generation?.code ?? null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-blue-700">
          Dashboard Overview
        </h1>
        <p className="text-gray-600 mt-1">
          Quick snapshot of your traceability activity
        </p>
      </div>

      {/* Trial Scoreboard */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-wide text-gray-500">
              Trial status
            </p>
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
          {subscriptionSummary ? tooltipText : summaryLoading ? 'Loading trial details...' : 'Trial data unavailable.'}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { key: 'generation', label: 'Generation' },
            { key: 'seats', label: 'Seats' },
            { key: 'plants', label: 'Plants' },
          ].map((item) => {
            const blocked = (subscriptionSummary as any)?.decisions?.[item.key]?.blocked ?? false;
            const reason = (subscriptionSummary as any)?.decisions?.[item.key]?.code ?? null;
            const remaining =
              item.key === 'generation'
                ? ((subscriptionSummary?.entitlement?.remaining?.unit ?? 0) +
                    (subscriptionSummary?.entitlement?.remaining?.box ?? 0) +
                    (subscriptionSummary?.entitlement?.remaining?.carton ?? 0) +
                    (subscriptionSummary?.entitlement?.remaining?.pallet ?? 0))
                : (subscriptionSummary?.entitlement?.remaining?.[item.key] ?? 0);
            const statusLabel = blocked ? reason || 'Blocked' : 'Allowed';
            const statusColor = blocked ? 'text-rose-600' : 'text-emerald-600';
            return (
              <div
                key={item.key}
                className="border border-dashed border-gray-200 rounded-xl px-4 py-3"
              >
                <p className="text-xs uppercase tracking-wide text-gray-500">{item.label}</p>
                <p className={`text-sm font-semibold ${statusColor}`}>{statusLabel}</p>
                <p className="text-xs text-gray-500">
                  {remaining} remaining
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-4">
        <KpiCard
          title="Total SKUs"
          value={kpi.totalSkus}
          icon={QrCode}
          href="/dashboard/sku"
        />
        <KpiCard
          title="Units Generated"
          value={kpi.unitsGenerated}
          icon={QrCode}
        />
        <KpiCard
          title="SSCC Generated"
          value={kpi.ssccGenerated}
          icon={Boxes}
        />
        <KpiCard
          title="Total Scans"
          value={kpi.totalScans}
          icon={Activity}
          href="/dashboard/scans"
        />
        <KpiCard
          title="Wallet Balance"
          value={kpi.walletBalance}
          icon={Wallet}
          href="/dashboard/settings"
        />
        <KpiCard
          title="Active Seats"
          value={kpi.activeSeats}
          icon={Activity}
          href="/dashboard/seats"
        />
        <KpiCard
          title="Active Handsets"
          value={kpi.activeHandsets}
          icon={Smartphone}
        />
      </div>

      {/* Realtime label generation (current trial period) */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Label Generation (Realtime)</h2>
        <p className="text-sm text-gray-600 mt-1">Shows labels generated in the current trial period.</p>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Unit Labels" value={kpi.unitLabels} icon={QrCode} />
          <KpiCard title="Box Labels" value={kpi.boxLabels} icon={Boxes} />
          <KpiCard title="Carton Labels" value={kpi.cartonLabels} icon={Boxes} />
          <KpiCard title="Pallet Labels" value={kpi.palletLabels} icon={Boxes} />
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white border rounded-lg p-4 h-64">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Label Generation Trend</h3>
          <LabelGenerationTrend data={[
            { date: '5 days ago', unit: stats?.label_generation?.unit ?? 0, box: stats?.label_generation?.box ?? 0, carton: stats?.label_generation?.carton ?? 0, pallet: stats?.label_generation?.pallet ?? 0 },
          ]} />
        </div>

        <div className="bg-white border rounded-lg p-4 h-64">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Labels by Level</h3>
          <LabelsByLevel data={{
            unit: stats?.label_generation?.unit ?? 0,
            box: stats?.label_generation?.box ?? 0,
            carton: stats?.label_generation?.carton ?? 0,
            pallet: stats?.label_generation?.pallet ?? 0,
          }} />
        </div>

        <div className="bg-white border rounded-lg p-4 h-64">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Cost Usage Distribution</h3>
          <CostUsageChart data={{
            unit: stats?.label_generation?.unit ?? 0,
            box: stats?.label_generation?.box ?? 0,
            carton: stats?.label_generation?.carton ?? 0,
            pallet: stats?.label_generation?.pallet ?? 0,
          }} />
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">
          Recent Activity
        </h2>

        {stats?.recent_activity && stats.recent_activity.length > 0 ? (
          <ul className="space-y-3 text-sm text-gray-600">
            {stats.recent_activity.map((activity) => (
              <li key={activity.id} className="flex items-start gap-2">
                <span className={activity.status === 'success' ? 'text-green-500' : activity.status === 'error' ? 'text-red-500' : 'text-yellow-500'}>
                  {activity.status === 'success' ? '✔' : activity.status === 'error' ? '✖' : '⚠'}
                </span>
                <div className="flex-1">
                  <span className="font-medium">{activity.action.replace(/_/g, ' ')}</span>
                  {activity.details?.description && (
                    <span className="text-gray-500"> — {activity.details.description}</span>
                  )}
                  <span className="text-xs text-gray-400 ml-2">
                    {new Date(activity.created_at).toLocaleString('en-IN', { 
                      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' 
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

      {/* CTA Section */}
      <div className="bg-gradient-to-r from-blue-50 to-white border rounded-xl p-8 flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <h3 className="text-2xl font-bold text-blue-700">
            Ready to generate labels?
          </h3>
          <p className="text-gray-600 mt-1">
            Start generating GS1-compliant QR & DataMatrix codes
          </p>
        </div>

        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            disabled={!assemblyAllowed || summaryLoading}
            onClick={() => router.push('/dashboard/generate')}
            className={`px-8 py-4 rounded-lg font-medium text-lg text-white transition ${
              (!assemblyAllowed && !summaryLoading) || summaryLoading
                ? 'bg-orange-300 cursor-not-allowed'
                : 'bg-orange-500 hover:bg-orange-600'
            }`}
          >
            Generate Labels
          </button>
          {!assemblyAllowed && subscriptionSummary && (
            <p className="text-xs text-rose-700">
              Generation locked: {generationBlockCode || 'blocked'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
