'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Boxes, QrCode, Smartphone, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type OverviewResponse = {
  company_id: string;
  company_name: string | null;
  subscription: {
    plan_name: string;
    status: string;
    status_code:
      | 'active_subscription'
      | 'payment_due'
      | 'active_until_end_date'
      | 'trial_active'
      | 'trial_expired'
      | 'no_active_plan';
    is_trial: boolean;
    trial_ends_at: string | null;
    subscription_starts_at: string | null;
    subscription_ends_at: string | null;
    renewal_at: string | null;
  };
  entitlement: {
    seat_usage: number;
    seat_limit: number;
    generation_usage_total: number;
    generation_remaining_total: number;
    remaining: Record<string, number>;
    limits: Record<string, number>;
    state: string;
  };
  kpis: {
    total_skus: number;
    total_handsets: number;
    total_scans: number;
    total_seats: number;
    total_labels_generated: number;
    total_sscc_generated: number;
  };
  generation_breakdown: {
    units: number;
    boxes: number;
    cartons: number;
    pallets: number;
  };
  recent_activity: Array<{
    id: string;
    action: string;
    status: string;
    metadata?: { description?: string };
    created_at: string;
  }>;
};

function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-gray-100" />
      ))}
    </div>
  );
}

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
    <div className="rounded-lg border bg-white p-4 transition hover:shadow-md">
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

function getStatusBadgeClass(code: OverviewResponse['subscription']['status_code']) {
  if (code === 'active_subscription') return 'bg-emerald-100 text-emerald-800';
  if (code === 'payment_due') return 'bg-amber-100 text-amber-800';
  if (code === 'active_until_end_date') return 'bg-blue-100 text-blue-800';
  if (code === 'trial_active') return 'bg-emerald-100 text-emerald-800';
  if (code === 'trial_expired') return 'bg-rose-100 text-rose-700';
  return 'bg-gray-100 text-gray-700';
}

function fmtNum(n: number | null | undefined) {
  return typeof n === 'number' ? n.toLocaleString('en-IN') : '-';
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch('/api/dashboard/stats', { cache: 'no-store', signal });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) throw new Error(String((body as any)?.error || 'Failed to load overview'));
    setOverview(body as OverviewResponse);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    (async () => {
      try {
        await refresh(controller.signal);
      } catch (err: any) {
        if (mounted) setError(String(err?.message || 'Failed to load overview'));
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        refresh(controller.signal).catch(() => undefined);
      }
    }, 20_000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
      if (!controller.signal.aborted) controller.abort();
    };
  }, [refresh]);

  const breakdownTotal = useMemo(() => {
    if (!overview) return 0;
    return (
      overview.generation_breakdown.units +
      overview.generation_breakdown.boxes +
      overview.generation_breakdown.cartons +
      overview.generation_breakdown.pallets
    );
  }, [overview]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-blue-700">Dashboard Overview</h1>
          <p className="mt-1 text-gray-600">Single source summary for subscription, entitlements, and operations.</p>
        </div>
        <div className="text-sm text-gray-500">{overview?.company_name || 'RxTrace Company'}</div>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        {loading || !overview ? (
          <SectionSkeleton rows={4} />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm uppercase tracking-wide text-gray-500">Current Plan</p>
                <h2 className="text-xl font-semibold text-gray-900">{overview.subscription.plan_name}</h2>
              </div>
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${getStatusBadgeClass(overview.subscription.status_code)}`}>
                {overview.subscription.status}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-dashed border-gray-200 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Renews / Expires</p>
                <p className="text-sm font-semibold text-gray-900">
                  {fmtDate(overview.subscription.renewal_at || overview.subscription.subscription_ends_at)}
                </p>
              </div>
              <div className="rounded-xl border border-dashed border-gray-200 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Seats Used / Total</p>
                <p className="text-sm font-semibold text-gray-900">
                  {fmtNum(overview.entitlement.seat_usage)} / {fmtNum(overview.entitlement.seat_limit)}
                </p>
              </div>
              <div className="rounded-xl border border-dashed border-gray-200 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Code Quota Used</p>
                <p className="text-sm font-semibold text-gray-900">{fmtNum(overview.entitlement.generation_usage_total)}</p>
              </div>
              <div className="rounded-xl border border-dashed border-gray-200 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Code Quota Remaining</p>
                <p className="text-sm font-semibold text-gray-900">{fmtNum(overview.entitlement.generation_remaining_total)}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <KpiCard title="Total SKUs" value={fmtNum(overview?.kpis.total_skus)} icon={QrCode} href="/dashboard/sku" loading={loading} />
        <KpiCard title="Total Handsets" value={fmtNum(overview?.kpis.total_handsets)} icon={Smartphone} loading={loading} />
        <KpiCard title="Total Scans" value={fmtNum(overview?.kpis.total_scans)} icon={Activity} href="/dashboard/scans" loading={loading} />
        <KpiCard title="Total Seats" value={fmtNum(overview?.kpis.total_seats)} icon={Users} href="/dashboard/seats" loading={loading} />
        <KpiCard title="Total Labels Generated" value={fmtNum(overview?.kpis.total_labels_generated)} icon={QrCode} loading={loading} />
        <KpiCard title="Total SSCC Generated" value={fmtNum(overview?.kpis.total_sscc_generated)} icon={Boxes} loading={loading} />
      </div>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Code Generation Breakdown</h2>
        {loading || !overview ? (
          <SectionSkeleton rows={4} />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {[
              { key: 'units', label: 'Units', value: overview.generation_breakdown.units },
              { key: 'boxes', label: 'Boxes', value: overview.generation_breakdown.boxes },
              { key: 'cartons', label: 'Cartons', value: overview.generation_breakdown.cartons },
              { key: 'pallets', label: 'Pallets', value: overview.generation_breakdown.pallets },
            ].map((item) => {
              const share = breakdownTotal > 0 ? ((item.value / breakdownTotal) * 100).toFixed(1) : '0.0';
              return (
                <div key={item.key} className="rounded-lg border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">{item.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-blue-700">{fmtNum(item.value)}</p>
                  <p className="mt-1 text-xs text-gray-500">{share}% share</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Recent Activity</h2>
        {loading ? (
          <SectionSkeleton rows={4} />
        ) : overview?.recent_activity?.length ? (
          <ul className="space-y-3 text-sm text-gray-600">
            {overview.recent_activity.map((activity) => (
              <li key={activity.id} className="flex items-start gap-2">
                <span className={activity.status === 'success' ? 'text-green-500' : activity.status === 'error' ? 'text-red-500' : 'text-yellow-500'}>
                  {activity.status === 'success' ? '[ok]' : activity.status === 'error' ? '[x]' : '[!]'}
                </span>
                <div className="flex-1">
                  <span className="font-medium">{String(activity.action || '').replace(/_/g, ' ')}</span>
                  {activity.metadata?.description ? <span className="text-gray-500"> - {activity.metadata.description}</span> : null}
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
    </div>
  );
}

