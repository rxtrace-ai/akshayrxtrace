"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Summary = {
  success: boolean;
  company?: { id: string; name: string };
  state?: string;
  trial?: { active: boolean; expires_at: string | null; days_remaining: number };
  period?: { start: string | null; end: string | null };
  subscription?: {
    status: string | null;
    cancel_at_period_end: boolean;
    current_period_start: string | null;
    current_period_end: string | null;
    next_billing_at: string | null;
    plan_name: string | null;
    billing_cycle: string | null;
    amount_paise: number;
  } | null;
  entitlement?: {
    limits: Record<string, number>;
    usage: Record<string, number>;
    remaining: Record<string, number>;
    topups: Record<string, number>;
    blocked: boolean;
  };
  invoices?: Array<{
    status: string;
    reference: string | null;
    plan: string | null;
    amount: number;
    currency: string;
    paid_at: string | null;
    invoice_pdf_url: string | null;
    created_at: string;
  }>;
  error?: string;
};

function formatINR(amount: number) {
  const value = Number(amount || 0);
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value);
  } catch {
    return `₹${value.toFixed(2)}`;
  }
}

export default function BillingPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/user/subscription/summary", { cache: "no-store" });
      const payload = (await res.json()) as Summary;
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || "Failed to load billing summary");
      }
      setSummary(payload);
    } catch (e: any) {
      setError(e?.message || "Failed to load billing summary");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const subscriptionBadge = useMemo(() => {
    const state = String(summary?.state || "").toUpperCase();
    if (state === "PAID_ACTIVE") return <Badge className="bg-green-600">Paid</Badge>;
    if (state === "TRIAL_ACTIVE") return <Badge className="bg-blue-600">Trial</Badge>;
    if (state === "TRIAL_EXPIRED") return <Badge variant="destructive">Trial expired</Badge>;
    return <Badge variant="secondary">No plan</Badge>;
  }, [summary?.state]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Billing</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-gray-600">Loading…</CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Billing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-red-600">{error}</div>
            <Button onClick={refresh} variant="outline">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const ent = summary?.entitlement;
  const sub = summary?.subscription;
  const invoices = summary?.invoices || [];

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Billing</h1>
          <div className="mt-2 flex items-center gap-2">
            {subscriptionBadge}
            {summary?.company?.name ? (
              <span className="text-sm text-gray-600">{summary.company.name}</span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={refresh} variant="outline">
            Refresh
          </Button>
          <Button asChild>
            <Link href="/dashboard/subscription">Upgrade / Add-ons</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plan</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-gray-700 space-y-2">
            <div>
              <span className="text-gray-500">Plan:</span> {sub?.plan_name || "—"}
            </div>
            <div>
              <span className="text-gray-500">Status:</span> {sub?.status || summary?.state || "—"}
            </div>
            <div>
              <span className="text-gray-500">Billing:</span>{" "}
              {sub?.billing_cycle ? String(sub.billing_cycle) : "—"}
            </div>
            <div>
              <span className="text-gray-500">Amount:</span>{" "}
              {sub ? formatINR(Number(sub.amount_paise || 0) / 100) : "—"}
            </div>
            <div>
              <span className="text-gray-500">Period:</span>{" "}
              {summary?.period?.start || "—"} → {summary?.period?.end || "—"}
            </div>
            {summary?.trial?.active ? (
              <div>
                <span className="text-gray-500">Trial ends:</span>{" "}
                {summary.trial.expires_at || "—"} ({summary.trial.days_remaining} days)
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Usage</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-gray-700 space-y-2">
            <div className="flex justify-between"><span>Units</span><span>{ent ? `${ent.usage.unit || 0} / ${ent.limits.unit || 0}` : "—"}</span></div>
            <div className="flex justify-between"><span>Boxes</span><span>{ent ? `${ent.usage.box || 0} / ${ent.limits.box || 0}` : "—"}</span></div>
            <div className="flex justify-between"><span>Cartons</span><span>{ent ? `${ent.usage.carton || 0} / ${ent.limits.carton || 0}` : "—"}</span></div>
            <div className="flex justify-between"><span>SSCC</span><span>{ent ? `${ent.usage.pallet || 0} / ${ent.limits.pallet || 0}` : "—"}</span></div>
            <div className="flex justify-between"><span>Seats</span><span>{ent ? `${ent.usage.seat || 0} / ${ent.limits.seat || 0}` : "—"}</span></div>
            <div className="flex justify-between"><span>Plants</span><span>{ent ? `${ent.usage.plant || 0} / ${ent.limits.plant || 0}` : "—"}</span></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoices</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {invoices.length === 0 ? (
            <div className="text-gray-600">No invoices yet.</div>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-left">
                <thead>
                  <tr className="text-gray-500">
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Reference</th>
                    <th className="py-2 pr-4">Plan</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">Paid</th>
                    <th className="py-2 pr-4">PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.slice(0, 20).map((inv) => (
                    <tr key={`${inv.created_at}-${inv.reference || ""}`} className="border-t">
                      <td className="py-2 pr-4">{inv.status}</td>
                      <td className="py-2 pr-4">{inv.reference || "—"}</td>
                      <td className="py-2 pr-4">{inv.plan || "—"}</td>
                      <td className="py-2 pr-4">{formatINR(Number(inv.amount || 0))}</td>
                      <td className="py-2 pr-4">{inv.paid_at || "—"}</td>
                      <td className="py-2 pr-4">
                        {inv.invoice_pdf_url ? (
                          <a className="text-blue-600 hover:underline" href={inv.invoice_pdf_url} target="_blank" rel="noreferrer">
                            Download
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
