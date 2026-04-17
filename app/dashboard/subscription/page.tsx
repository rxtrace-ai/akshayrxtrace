"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Plan = {
  template_id: string;
  name: string;
  description: string | null;
  billing_cycle: "monthly" | "yearly";
  plan_price_paise: number;
  pricing_unit_size: number;
  quotas: Record<string, number>;
  capacities: Record<string, number>;
};

type CheckoutContextPayload = {
  success: boolean;
  plans: Plan[];
  subscriptionStatus?: {
    status: "active" | "pending" | "expired" | "cancelled";
    source?: "trial" | "subscription" | null;
    trialExpiresAt: string | null;
  };
  current_subscription: null | {
    id: string;
    status: string | null;
    cancel_at_period_end: boolean;
    current_period_start: string | null;
    current_period_end: string | null;
    next_billing_at: string | null;
    start_date: string | null;
    renewal_date: string | null;
    plan_name: string | null;
    billing_cycle: string | null;
    plan_price_paise: number;
  };
};

type SummaryInvoice = {
  id: string;
  invoice_type: string;
  invoice_label: string;
  status: string;
  reference: string | null;
  plan: string | null;
  amount: number;
  currency: string | null;
  period_start: string | null;
  period_end: string | null;
  issued_at: string | null;
  paid_at: string | null;
  invoice_pdf_url: string | null;
  created_at: string | null;
};

type SubscriptionSummary = {
  success: boolean;
  subscriptionStatus?: {
    status: "active" | "pending" | "expired" | "cancelled";
    source?: "trial" | "subscription" | null;
    trialExpiresAt: string | null;
  };
  subscription: null | {
    status: string | null;
    cancel_at_period_end: boolean;
    current_period_start: string | null;
    current_period_end: string | null;
    next_billing_at: string | null;
    start_date: string | null;
    renewal_date: string | null;
    plan_name: string | null;
    billing_cycle: string | null;
    plan_price_paise: number;
  };
  quota_table: Array<{
    metric: string;
    allocated: number;
    consumed: number;
    remaining: number;
  }>;
  subscription_invoices?: SummaryInvoice[];
};

type QuoteApiResponse = {
  success: boolean;
  quote_id?: string;
  error?: string;
};

function formatINRFromPaise(paise: number) {
  return `\u20B9${(Number(paise || 0) / 100).toFixed(2)}`;
}

function formatDateLabel(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function normalizeStatusLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "Inactive";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-[0.24em] text-slate-400">{label}</p>
      <p className="mt-2 text-base font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export default function SubscriptionPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [context, setContext] = useState<CheckoutContextPayload | null>(null);
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [selectedPlanTemplateId, setSelectedPlanTemplateId] = useState("");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  const loadContext = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/user/subscription/checkout/context", { cache: "no-store" });
    const payload = (await res.json()) as CheckoutContextPayload;
    if (!res.ok || !payload.success) throw new Error((payload as any).error || "Failed to load subscription context");
    setContext(payload);
    setSelectedPlanTemplateId((current) => current || payload.plans[0]?.template_id || "");
    setLoading(false);
  }, []);

  const refreshSummary = useCallback(async () => {
    setSummaryLoading(true);
    const res = await fetch("/api/user/subscription/summary", { cache: "no-store" });
    const payload = (await res.json()) as SubscriptionSummary;
    if (!res.ok || !payload.success) throw new Error((payload as any).error || "Failed to load subscription summary");
    setSummary(payload);
    setSummaryLoading(false);
  }, []);

  const refreshPageState = useCallback(async () => {
    await Promise.all([loadContext(), refreshSummary()]);
  }, [loadContext, refreshSummary]);

  useEffect(() => {
    refreshPageState().catch((err: any) => {
      setError(err?.message || "Failed to load subscription page");
      setLoading(false);
      setSummaryLoading(false);
    });
  }, [refreshPageState]);

  const plans = useMemo(() => context?.plans ?? [], [context?.plans]);
  const currentSubscription = summary?.subscription ?? context?.current_subscription ?? null;
  const subscriptionStatus = summary?.subscriptionStatus?.status ?? context?.subscriptionStatus?.status ?? "expired";
  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.template_id === selectedPlanTemplateId) ?? null,
    [plans, selectedPlanTemplateId]
  );
  const currentPlanId = useMemo(() => {
    if (!context?.current_subscription?.plan_name) return null;
    const match = plans.find((plan) => plan.name === context.current_subscription?.plan_name);
    return match?.template_id ?? null;
  }, [context?.current_subscription?.plan_name, plans]);
  const subscriptionInvoices = summary?.subscription_invoices || [];

  const startSubscriptionCheckout = useCallback(
    async (planTemplateId?: string) => {
      const targetPlanTemplateId = String(planTemplateId || selectedPlanTemplateId || "").trim();
      if (!targetPlanTemplateId) {
        setError("Select a subscription plan first.");
        return;
      }

      setSubmitting(true);
      setError(null);
      setMessage(null);
      try {
        const res = await fetch("/api/user/subscription/checkout/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan_id: targetPlanTemplateId,
            plan_template_id: targetPlanTemplateId,
          }),
        });
        const payload = (await res.json()) as QuoteApiResponse;
        if (!res.ok || !payload.success || !payload.quote_id) {
          throw new Error(payload.error || "Failed to prepare checkout");
        }
        router.push(`/dashboard/checkout/${payload.quote_id}`);
      } catch (err: any) {
        setError(err?.message || "Failed to prepare checkout");
      } finally {
        setSubmitting(false);
      }
    },
    [router, selectedPlanTemplateId]
  );

  const cancelSubscription = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/user/subscription/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || "Failed to cancel subscription");
      }
      setMessage(`Subscription ends on ${formatDateLabel(payload.subscription?.current_period_end)}.`);
      await refreshPageState();
    } catch (err: any) {
      setError(err?.message || "Failed to cancel subscription");
    } finally {
      setSubmitting(false);
    }
  }, [refreshPageState]);

  if (loading) return <p className="text-sm text-slate-500">Loading subscription...</p>;
  if (!context) return <p className="text-sm text-rose-600">Unable to load subscription context.</p>;

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-2 py-2">
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.12),_transparent_35%),linear-gradient(135deg,#f8fafc_0%,#ecfdf5_100%)] p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <Badge variant="outline" className="border-emerald-200 bg-white/80 text-emerald-700">
              Subscription Billing
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Manage your base plan in one clean place.</h1>
            <p className="text-sm leading-6 text-slate-600">
              This page is now dedicated to subscription lifecycle only: current status, plan changes, renewal actions, and
              subscription invoices. Capacity and code purchases now live on the add-ons page.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline" className="bg-white">
              <Link href="/dashboard/add-ons">Open Add-ons</Link>
            </Button>
            <Button onClick={() => startSubscriptionCheckout()} disabled={submitting || !selectedPlanTemplateId}>
              {currentSubscription ? "Change Plan" : "Start Subscription"}
            </Button>
          </div>
        </div>
      </section>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-[28px] border-slate-200">
          <CardHeader>
            <CardTitle>Current Subscription</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 text-sm">
            {summaryLoading ? (
              <p className="text-slate-500">Loading subscription summary...</p>
            ) : currentSubscription ? (
              <>
                <div className="flex flex-col gap-4 rounded-[24px] border border-slate-200 bg-slate-50/80 p-5 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xl font-semibold text-slate-950">{currentSubscription.plan_name || "Subscription"}</p>
                      <Badge variant="outline">{normalizeStatusLabel(subscriptionStatus)}</Badge>
                    </div>
                    <p className="text-slate-600">
                      {currentSubscription.billing_cycle || "-"} | {formatINRFromPaise(currentSubscription.plan_price_paise || 0)}
                    </p>
                    <p className="text-slate-500">
                      {currentSubscription.cancel_at_period_end
                        ? `Scheduled to end on ${formatDateLabel(currentSubscription.current_period_end)}`
                        : `Active until ${formatDateLabel(currentSubscription.current_period_end)}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => startSubscriptionCheckout(currentPlanId || selectedPlanTemplateId)} disabled={submitting}>
                      Renew
                    </Button>
                    <Button variant="outline" onClick={() => startSubscriptionCheckout()} disabled={submitting || !selectedPlanTemplateId}>
                      Upgrade or Downgrade
                    </Button>
                    {subscriptionStatus === "active" ? (
                      <Button variant="destructive" onClick={() => setCancelDialogOpen(true)} disabled={submitting}>
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-4">
                  <MetricCard label="Start Date" value={formatDateLabel(currentSubscription.start_date)} />
                  <MetricCard label="Current Period End" value={formatDateLabel(currentSubscription.current_period_end)} />
                  <MetricCard label="Renewal Date" value={formatDateLabel(currentSubscription.renewal_date || currentSubscription.next_billing_at)} />
                  <MetricCard label="Status" value={normalizeStatusLabel(currentSubscription.status)} />
                </div>

                <div className="overflow-x-auto rounded-[24px] border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-[0.2em] text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Resource</th>
                        <th className="px-4 py-3">Allocated</th>
                        <th className="px-4 py-3">Consumed</th>
                        <th className="px-4 py-3">Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary?.quota_table.map((row) => (
                        <tr key={row.metric} className="border-t border-slate-200">
                          <td className="px-4 py-3 font-medium capitalize text-slate-900">{row.metric}</td>
                          <td className="px-4 py-3 text-slate-600">{row.allocated.toLocaleString()}</td>
                          <td className="px-4 py-3 text-slate-600">{row.consumed.toLocaleString()}</td>
                          <td className="px-4 py-3 text-slate-600">{row.remaining.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-4 rounded-[24px] border border-dashed border-slate-300 bg-white p-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-base font-semibold text-slate-950">No active subscription</p>
                  <p className="mt-1 text-slate-500">Choose a plan below to activate billing and start using your base quotas.</p>
                </div>
                <Button onClick={() => startSubscriptionCheckout()} disabled={submitting || !selectedPlanTemplateId}>
                  {subscriptionStatus === "expired" || subscriptionStatus === "cancelled" ? "Renew" : "Start Subscription"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-slate-200">
          <CardHeader>
            <CardTitle>Subscription Invoices</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!subscriptionInvoices.length ? (
              <p className="text-sm text-slate-500">No subscription invoices yet.</p>
            ) : (
              subscriptionInvoices.map((invoice) => (
                <div key={invoice.id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-semibold text-slate-950">{invoice.reference || "Invoice"}</p>
                      <p className="text-xs text-slate-500">
                        {invoice.invoice_label} | {invoice.status} | {formatDateLabel(invoice.created_at)}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        Period: {formatDateLabel(invoice.period_start)} to {formatDateLabel(invoice.period_end)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="font-semibold text-slate-950">INR {Number(invoice.amount || 0).toFixed(2)}</p>
                        <p className="text-xs text-slate-500">{invoice.currency || "INR"}</p>
                      </div>
                      {invoice.invoice_pdf_url ? (
                        <Button asChild variant="outline">
                          <a href={invoice.invoice_pdf_url} target="_blank" rel="noreferrer">
                            Download
                          </a>
                        </Button>
                      ) : (
                        <Button variant="outline" disabled>
                          PDF Pending
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-[28px] border-slate-200">
        <CardHeader>
          <CardTitle>Available Plans</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-2">
            {plans.map((plan) => {
              const isSelected = selectedPlanTemplateId === plan.template_id;
              const isCurrent = currentPlanId === plan.template_id;
              return (
                <label
                  key={plan.template_id}
                  className={`cursor-pointer rounded-[24px] border p-5 transition ${
                    isSelected ? "border-emerald-400 bg-emerald-50/70" : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-semibold text-slate-950">{plan.name}</p>
                        {isCurrent ? <Badge>Current</Badge> : null}
                      </div>
                      <p className="text-sm text-slate-500">
                        {plan.billing_cycle} | {formatINRFromPaise(plan.plan_price_paise)}
                      </p>
                      {plan.description ? <p className="text-sm leading-6 text-slate-600">{plan.description}</p> : null}
                    </div>
                    <input type="radio" name="plan" checked={isSelected} onChange={() => setSelectedPlanTemplateId(plan.template_id)} />
                  </div>

                  <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
                    <p>Units: {plan.quotas.unit.toLocaleString()}</p>
                    <p>Boxes: {plan.quotas.box.toLocaleString()}</p>
                    <p>Cartons: {plan.quotas.carton.toLocaleString()}</p>
                    <p>Pallets: {plan.quotas.pallet.toLocaleString()}</p>
                    <p>Seats: {plan.capacities.seat}</p>
                    <p>Plants: {plan.capacities.plant}</p>
                    <p>Handsets: {plan.capacities.handset}</p>
                    <p>1 unit = {plan.pricing_unit_size.toLocaleString()} codes</p>
                  </div>
                </label>
              );
            })}
          </div>

          {selectedPlan ? (
            <div className="flex flex-col gap-4 rounded-[24px] border border-slate-200 bg-slate-50/80 p-5 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-lg font-semibold text-slate-950">{selectedPlan.name}</p>
                <p className="text-sm text-slate-500">
                  {selectedPlan.billing_cycle} | {formatINRFromPaise(selectedPlan.plan_price_paise)}
                </p>
              </div>
              <Button onClick={() => startSubscriptionCheckout(selectedPlan.template_id)} disabled={submitting}>
                {currentSubscription ? "Review Checkout" : "Start Subscription"}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              Your subscription will remain active until {formatDateLabel(currentSubscription?.current_period_end)}. After this
              date, the subscription will expire.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Keep Subscription</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={(event) => {
                event.preventDefault();
                cancelSubscription().then(() => setCancelDialogOpen(false));
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              Confirm Cancel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
