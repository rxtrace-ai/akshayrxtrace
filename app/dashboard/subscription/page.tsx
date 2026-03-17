"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Plan = {
  template_id: string;
  name: string;
  description: string | null;
  billing_cycle: "monthly" | "yearly";
  plan_price_paise: number;
  pricing_unit_size: number;
  version_id: string;
  version_number: number;
  quota_units: Record<string, number>;
  quotas: Record<string, number>;
  capacities: Record<string, number>;
};

type AddOn = {
  id: string;
  name: string;
  description: string | null;
  price_inr: number;
  pricing_unit_size: number;
  unit: string;
  addon_kind: "structural" | "variable_quota";
  entitlement_key: string;
  billing_mode: "recurring" | "one_time";
};

type CheckoutContextPayload = {
  success: boolean;
  company: { id: string; name: string | null };
  plans: Plan[];
  add_ons: AddOn[];
  subscriptionStatus?: {
    status: "active" | "pending" | "expired" | "cancelled";
    trialExpiresAt: string | null;
  };
  current_subscription: null | {
    id: string;
    status: string | null;
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

type SubscriptionSummary = {
  success: boolean;
  subscriptionStatus?: {
    status: "active" | "pending" | "expired" | "cancelled";
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
    subscription_allocated: number;
    addon_allocated: number;
    consumed: number;
    remaining: number;
  }>;
  entitlement: {
    remaining: Record<string, number>;
  };
  capacity_addons: Array<{
    addon_id: string;
    name: string | null;
    entitlement_key: string | null;
    quantity: number;
    status: string;
  }>;
  add_on_balances: Record<string, number>;
};

type QuoteLine = {
  addon_id: string;
  name: string;
  entitlement_key: string;
  quantity: number;
  unit_price_paise: number;
  line_total_paise: number;
  pricing_unit_size?: number;
  allocated_quota?: number;
  allocated_capacity?: number;
};

type CheckoutQuote = {
  expires_at: string;
  plan: {
    name: string;
    description: string | null;
    billing_cycle: "monthly" | "yearly";
    plan_price_paise: number;
    pricing_unit_size: number;
    quota_units: Record<string, number>;
    quotas: Record<string, number>;
    capacities: Record<string, number>;
  };
  capacity_addons: QuoteLine[];
  code_addons: QuoteLine[];
  totals: {
    currency: "INR";
    subscription_paise: number;
    capacity_addons_paise: number;
    code_addons_paise: number;
    grand_total_paise: number;
  };
};

type InitiateResponse = {
  success: boolean;
  checkout_session_id: string;
  status: string;
  expires_at: string;
  payment_required_in_phase_3?: boolean;
};

type PaymentInitiateResponse = {
  success: boolean;
  razorpay: {
    key_id: string | null;
    subscription_id?: string;
    order_id?: string;
    amount_paise?: number;
    currency: string;
  };
};

function formatINRFromPaise(paise: number) {
  const inr = (Number(paise || 0) / 100).toFixed(2);
  return `\u20B9${inr}`;
}

async function loadRazorpayScript(): Promise<void> {
  if (typeof window === "undefined") return;
  if ((window as any).Razorpay) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("RAZORPAY_SCRIPT_LOAD_FAILED")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("RAZORPAY_SCRIPT_LOAD_FAILED"));
    document.body.appendChild(script);
  });
  if (!(window as any).Razorpay) throw new Error("RAZORPAY_SDK_NOT_AVAILABLE");
}

export default function SubscriptionCheckoutPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [context, setContext] = useState<CheckoutContextPayload | null>(null);
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [selectedPlanTemplateId, setSelectedPlanTemplateId] = useState<string>("");
  const [capacityQty, setCapacityQty] = useState<Record<string, number>>({});
  const [codeQty, setCodeQty] = useState<Record<string, number>>({});

  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [quoteSignature, setQuoteSignature] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);

  const loadContext = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/user/subscription/checkout/context", { cache: "no-store" });
      const payload = (await res.json()) as CheckoutContextPayload;
      if (!res.ok || !payload.success) {
        throw new Error((payload as any).error || "Failed to load subscription context");
      }
      setContext(payload);
      if (!selectedPlanTemplateId && payload.plans.length > 0) {
        setSelectedPlanTemplateId(payload.plans[0].template_id);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load subscription context");
    } finally {
      setLoading(false);
    }
  }, [selectedPlanTemplateId]);

  const refreshSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const res = await fetch("/api/user/subscription/summary", { cache: "no-store" });
      const payload = (await res.json()) as SubscriptionSummary;
      if (!res.ok || !payload.success) {
        throw new Error((payload as any).error || "Failed to load subscription summary");
      }
      setSummary(payload);
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadContext();
    refreshSummary();
  }, [loadContext, refreshSummary]);

  const { capacityAddOns, codeAddOns } = useMemo(() => {
    const addOns = context?.add_ons || [];
    return {
      capacityAddOns: addOns.filter((a) => a.addon_kind === "structural" && a.billing_mode === "recurring"),
      codeAddOns: addOns.filter((a) => a.addon_kind === "variable_quota" && a.billing_mode === "one_time"),
    };
  }, [context]);

  const capacitySelection = useMemo(
    () =>
      Object.entries(capacityQty)
        .map(([addon_id, quantity]) => ({ addon_id, quantity: Math.max(0, Number(quantity) || 0) }))
        .filter((row) => row.quantity > 0),
    [capacityQty]
  );

  const codeSelection = useMemo(
    () =>
      Object.entries(codeQty)
        .map(([addon_id, quantity]) => ({ addon_id, quantity: Math.max(0, Number(quantity) || 0) }))
        .filter((row) => row.quantity > 0),
    [codeQty]
  );

  const selectionKey = useMemo(() => {
    const stableSort = (rows: Array<{ addon_id: string; quantity: number }>) =>
      [...rows].sort((a, b) => a.addon_id.localeCompare(b.addon_id));
    return JSON.stringify({
      plan: selectedPlanTemplateId,
      capacity: stableSort(capacitySelection),
      code: stableSort(codeSelection),
    });
  }, [capacitySelection, codeSelection, selectedPlanTemplateId]);

  const computeQuote = useCallback(async () => {
    if (!selectedPlanTemplateId) return;
    setQuoteLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/user/subscription/checkout/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_template_id: selectedPlanTemplateId,
          capacity_addons: capacitySelection,
          code_addons: codeSelection,
        }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || "Failed to compute quote");
      }
      setQuote(payload.quote as CheckoutQuote);
      setQuoteSignature(String(payload.quote_signature || ""));
    } catch (err: any) {
      setQuote(null);
      setQuoteSignature("");
      setError(err?.message || "Failed to compute quote");
    } finally {
      setQuoteLoading(false);
    }
  }, [capacitySelection, codeSelection, selectedPlanTemplateId]);

  useEffect(() => {
    if (!context) return;
    computeQuote();
  }, [context, computeQuote, selectionKey]);

  async function cancelSubscription() {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/user/subscription/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({}),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || "Failed to cancel subscription");
      }
      setMessage("Subscription cancelled.");
      await refreshSummary();
      await loadContext();
    } catch (err: any) {
      setError(err?.message || "Failed to cancel subscription");
    } finally {
      setSubmitting(false);
    }
  }

  async function initiateCheckout() {
    if (!quote || !quoteSignature) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/user/subscription/checkout/initiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          quote,
          quote_signature: quoteSignature,
        }),
      });
      const payload = (await res.json()) as InitiateResponse;
      if (!res.ok || !payload.success) {
        throw new Error((payload as any).error || "Failed to create checkout session");
      }
      setCheckoutSessionId(payload.checkout_session_id);
      const paymentRes = await fetch("/api/user/subscription/checkout/payment/initiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          checkout_session_id: payload.checkout_session_id,
        }),
      });
      const paymentPayload = (await paymentRes.json()) as PaymentInitiateResponse;
      if (!paymentRes.ok || !paymentPayload.success) {
        throw new Error((paymentPayload as any).error || "Failed to initialize Razorpay payment");
      }

      await loadRazorpayScript();
      const RazorpayCtor = (window as any).Razorpay;

      await new Promise<void>((resolve) => {
        const razorpayOptions: Record<string, unknown> = {
          key: paymentPayload.razorpay.key_id,
          currency: paymentPayload.razorpay.currency || "INR",
          name: "RxTrace",
          description: "Subscription checkout",
          handler: () => resolve(),
          modal: { ondismiss: () => resolve() },
        };
        if (paymentPayload.razorpay.subscription_id) {
          razorpayOptions.subscription_id = paymentPayload.razorpay.subscription_id;
        } else if (paymentPayload.razorpay.order_id) {
          razorpayOptions.order_id = paymentPayload.razorpay.order_id;
          razorpayOptions.amount = paymentPayload.razorpay.amount_paise || 0;
        } else {
          throw new Error("Missing Razorpay checkout reference");
        }

        const rzp = new RazorpayCtor({
          ...razorpayOptions,
        });
        rzp.open();
      });

      setMessage("Payment submitted. Subscription will activate after webhook confirmation.");
      await refreshSummary();
      await loadContext();
    } catch (err: any) {
      setError(err?.message || "Failed to create checkout session");
    } finally {
      setSubmitting(false);
    }
  }

  const currentPlanId = useMemo(() => {
    if (!context?.current_subscription?.plan_name) return null;
    const match = context.plans.find((plan) => plan.name === context.current_subscription?.plan_name);
    return match?.template_id ?? null;
  }, [context]);

  if (loading) {
    return <p className="text-sm text-gray-500">Loading subscription...</p>;
  }

  if (!context) {
    return <p className="text-sm text-rose-600">Unable to load subscription context.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Subscription</h1>
        <p className="max-w-2xl text-sm text-gray-500">
          Select a subscription plan, add code or capacity add-ons, and complete Razorpay checkout to activate your subscription.
        </p>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}
      {message && <p className="text-sm text-emerald-700">{message}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Current Subscription</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {summaryLoading ? (
            <p className="text-gray-500">Loading summary...</p>
          ) : summary ? (
            <>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-medium">{summary.subscription?.plan_name || "No active plan"}</p>
                  <p className="text-gray-500">
                    {summary.subscription?.billing_cycle || "-"} · {formatINRFromPaise(summary.subscription?.plan_price_paise || 0)}
                  </p>
                </div>
                <Badge className="bg-gray-100 text-gray-800">
                  {summary.subscriptionStatus?.status || summary.subscription?.status || "expired"}
                </Badge>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                <div>
                  <p className="text-gray-500">Start date</p>
                  <p>{summary.subscription?.start_date ? new Date(summary.subscription.start_date).toLocaleDateString() : "-"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Renewal date</p>
                  <p>{summary.subscription?.renewal_date ? new Date(summary.subscription.renewal_date).toLocaleDateString() : "-"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Status</p>
                  <p>{summary.subscription?.status || "-"}</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-gray-100">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-gray-400">
                    <tr>
                      <th className="px-3 py-2">Code Type</th>
                      <th className="px-3 py-2">Allocated</th>
                      <th className="px-3 py-2">Consumed</th>
                      <th className="px-3 py-2">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.quota_table.map((row) => (
                      <tr key={row.metric} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-medium capitalize">{row.metric}</td>
                        <td className="px-3 py-2">{row.allocated.toLocaleString()}</td>
                        <td className="px-3 py-2">{row.consumed.toLocaleString()}</td>
                        <td className="px-3 py-2">{row.remaining.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="font-medium text-gray-700">Capacity Add-ons</p>
                  {summary.capacity_addons?.length ? (
                    summary.capacity_addons.map((row) => (
                      <div key={row.addon_id} className="flex items-center justify-between rounded border px-3 py-2">
                        <div>
                          <p>{row.name || row.addon_id}</p>
                          <p className="text-xs text-gray-500">{row.entitlement_key}</p>
                        </div>
                        <p className="font-medium">+{row.quantity}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-gray-500">No active capacity add-ons.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <p className="font-medium text-gray-700">Code Add-on Balances</p>
                  <div className="grid gap-2 md:grid-cols-2">
                    {["unit", "box", "carton", "pallet"].map((metric) => (
                      <div key={metric} className="rounded border px-3 py-2">
                        <p className="text-xs uppercase text-gray-400">{metric}</p>
                        <p className="text-lg font-semibold">{summary.add_on_balances?.[metric] ?? 0}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <Button variant="destructive" onClick={cancelSubscription} disabled={submitting || !summary.subscription}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <p className="text-gray-500">Summary unavailable.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Available Plans</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {context.plans.map((plan) => {
            const isSelected = selectedPlanTemplateId === plan.template_id;
            const isCurrent = currentPlanId === plan.template_id;
            return (
              <label
                key={plan.template_id}
                className={`cursor-pointer rounded-lg border p-4 ${isSelected ? "border-green-500 bg-green-50" : "border-gray-200 bg-white"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{plan.name}</p>
                    <p className="text-xs text-gray-500">
                      {plan.billing_cycle} · {formatINRFromPaise(plan.plan_price_paise)}
                    </p>
                    {plan.description ? <p className="mt-2 text-sm text-gray-600">{plan.description}</p> : null}
                  </div>
                  <input
                    type="radio"
                    name="plan"
                    checked={isSelected}
                    onChange={() => setSelectedPlanTemplateId(plan.template_id)}
                  />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
                  <p>Unit: {plan.quotas.unit.toLocaleString()}</p>
                  <p>Box: {plan.quotas.box.toLocaleString()}</p>
                  <p>Carton: {plan.quotas.carton.toLocaleString()}</p>
                  <p>Pallet: {plan.quotas.pallet.toLocaleString()}</p>
                  <p>Seats: {plan.capacities.seat}</p>
                  <p>Plants: {plan.capacities.plant}</p>
                  <p>Handsets: {plan.capacities.handset}</p>
                </div>

                <div className="mt-3 flex gap-2">
                  <Badge variant="outline">1 unit = {plan.pricing_unit_size.toLocaleString()} codes</Badge>
                  {isCurrent ? <Badge>Current</Badge> : null}
                </div>
              </label>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add-ons</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <p className="font-medium text-gray-700">Code Add-ons</p>
            <div className="grid gap-3 md:grid-cols-2">
              {codeAddOns.map((addon) => (
                <div key={addon.id} className="rounded-lg border p-4">
                  <p className="font-medium">{addon.name}</p>
                  <p className="text-xs text-gray-500">
                    {addon.entitlement_key} · {addon.pricing_unit_size.toLocaleString()} codes per unit · INR {addon.price_inr}
                  </p>
                  {addon.description ? <p className="mt-2 text-sm text-gray-600">{addon.description}</p> : null}
                  <div className="mt-3 space-y-1">
                    <LabelText text="Units to Purchase" />
                    <Input
                      type="number"
                      min={0}
                      value={codeQty[addon.id] ?? 0}
                      onChange={(e) =>
                        setCodeQty((prev) => ({ ...prev, [addon.id]: Math.max(0, Number(e.target.value) || 0) }))
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="font-medium text-gray-700">Capacity Add-ons</p>
            <div className="grid gap-3 md:grid-cols-2">
              {capacityAddOns.map((addon) => (
                <div key={addon.id} className="rounded-lg border p-4">
                  <p className="font-medium">{addon.name}</p>
                  <p className="text-xs text-gray-500">
                    {addon.entitlement_key} · recurring · INR {addon.price_inr}
                  </p>
                  {addon.description ? <p className="mt-2 text-sm text-gray-600">{addon.description}</p> : null}
                  <div className="mt-3 space-y-1">
                    <LabelText text="Quantity" />
                    <Input
                      type="number"
                      min={0}
                      value={capacityQty[addon.id] ?? 0}
                      onChange={(e) =>
                        setCapacityQty((prev) => ({ ...prev, [addon.id]: Math.max(0, Number(e.target.value) || 0) }))
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Checkout</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {quoteLoading ? <p className="text-gray-500">Calculating checkout…</p> : null}
          {quote ? (
            <>
              <div className="rounded-lg border p-4">
                <p className="font-medium">Subscription</p>
                <p className="mt-1">{quote.plan.name}</p>
                <p className="text-gray-500">
                  {quote.plan.billing_cycle} · {formatINRFromPaise(quote.plan.plan_price_paise)}
                </p>
              </div>

              <div className="rounded-lg border p-4">
                <p className="font-medium">Code Add-ons</p>
                {quote.code_addons.length ? (
                  <div className="mt-2 space-y-2">
                    {quote.code_addons.map((line) => (
                      <div key={line.addon_id} className="flex items-center justify-between">
                        <div>
                          <p>{line.name}</p>
                          <p className="text-xs text-gray-500">
                            {line.quantity} units · {line.allocated_quota?.toLocaleString()} codes
                          </p>
                        </div>
                        <span>{formatINRFromPaise(line.line_total_paise)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-gray-500">No code add-ons selected.</p>
                )}
              </div>

              <div className="rounded-lg border p-4">
                <p className="font-medium">Capacity Add-ons</p>
                {quote.capacity_addons.length ? (
                  <div className="mt-2 space-y-2">
                    {quote.capacity_addons.map((line) => (
                      <div key={line.addon_id} className="flex items-center justify-between">
                        <div>
                          <p>{line.name}</p>
                          <p className="text-xs text-gray-500">{line.quantity} additional {line.entitlement_key}</p>
                        </div>
                        <span>{formatINRFromPaise(line.line_total_paise)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-gray-500">No capacity add-ons selected.</p>
                )}
              </div>

              <div className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <span>Subscription</span>
                  <span>{formatINRFromPaise(quote.totals.subscription_paise)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span>Code Add-ons</span>
                  <span>{formatINRFromPaise(quote.totals.code_addons_paise)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span>Capacity Add-ons</span>
                  <span>{formatINRFromPaise(quote.totals.capacity_addons_paise)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between border-t pt-3 font-semibold">
                  <span>Total</span>
                  <span>{formatINRFromPaise(quote.totals.grand_total_paise)}</span>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-gray-500">
                  Amounts are server-calculated and locked in the checkout session before Razorpay payment.
                </p>
                <Button onClick={initiateCheckout} disabled={submitting || !quote || !quoteSignature}>
                  {context.current_subscription ? "Pay & Upgrade" : "Pay & Subscribe"}
                </Button>
              </div>
              {checkoutSessionId ? <p className="text-xs text-gray-500">Checkout session: {checkoutSessionId}</p> : null}
            </>
          ) : (
            <p className="text-gray-500">Select a plan to view checkout details.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LabelText({ text }: { text: string }) {
  return <p className="text-sm font-medium text-gray-700">{text}</p>;
}
