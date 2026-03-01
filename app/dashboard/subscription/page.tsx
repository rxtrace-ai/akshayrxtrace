"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Plan = {
  template_id: string;
  name: string;
  billing_cycle: "monthly" | "yearly";
  amount_paise: number;
  version_id: string;
  version_number: number;
  limits: Record<string, number>;
};

type AddOn = {
  id: string;
  name: string;
  price_inr: number;
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
  eligible_coupons: Array<{ code: string; type: string; value: number; scope: string }>;
  subscriptionStatus?: {
    status: "active" | "trial" | "expired";
    trialExpiresAt: string | null;
  };
  current_subscription: null | {
    id: string;
    status: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    next_billing_at: string | null;
    plan_name: string | null;
    billing_cycle: string | null;
    amount_paise: number;
  };
};

type SubscriptionSummary = {
  success: boolean;
  subscriptionStatus?: {
    status: "active" | "trial" | "expired";
    trialExpiresAt: string | null;
  };
  subscription: null | {
    status: string | null;
    cancel_at_period_end: boolean;
    current_period_start: string | null;
    current_period_end: string | null;
    next_billing_at: string | null;
    plan_name: string | null;
    billing_cycle: string | null;
    amount_paise: number;
  };
  entitlement: {
    state: string;
    period_start: string | null;
    period_end: string | null;
    trial_active: boolean;
    trial_expires_at: string | null;
    limits: Record<string, number>;
    usage: Record<string, number>;
    remaining: Record<string, number>;
    topups: Record<string, number>;
    blocked: boolean;
  };
  structural_addons: Array<{
    addon_id: string;
    name: string | null;
    entitlement_key: string | null;
    quantity: number;
    status: string;
  }>;
  invoices: Array<{
    invoice_type: string;
    status: string;
    reference: string | null;
    plan: string | null;
    amount: number;
    currency: string;
    issued_at: string | null;
    paid_at: string | null;
    invoice_pdf_url: string | null;
    created_at: string;
  }>;
};

type QuoteLine = {
  addon_id: string;
  name: string;
  entitlement_key: string;
  quantity: number;
  unit_price_paise: number;
  line_total_paise: number;
};

type CheckoutQuote = {
  expires_at: string;
  plan: { name: string; billing_cycle: "monthly" | "yearly"; amount_paise: number };
  structural_addons: QuoteLine[];
  variable_topups: QuoteLine[];
  coupon: null | { code: string; discount_paise: number; scope: string; razorpay_offer_id: string | null };
  totals: {
    currency: "INR";
    subscription_paise: number;
    structural_addons_paise: number;
    variable_topups_paise: number;
    discount_paise: number;
    grand_total_paise: number;
  };
};

type InitiateResponse = {
  success: boolean;
  checkout_session_id: string;
  status: string;
  expires_at: string;
  checkout: {
    subscription: any;
    topup: any | null;
  };
  replay?: boolean;
  webhook_activation_pending?: boolean;
};

declare global {
  interface Window {
    Razorpay?: any;
  }
}

function formatINRFromPaise(paise: number) {
  const inr = (Number(paise || 0) / 100).toFixed(2);
  return `\u20B9${inr}`;
}

function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

function getSavedCheckout(): { sessionId: string | null; status: string | null; idempotencyKey: string | null } {
  if (typeof window === "undefined") {
    return { sessionId: null, status: null, idempotencyKey: null };
  }
  return {
    sessionId: window.localStorage.getItem("rxtrace_checkout_session_id"),
    status: window.localStorage.getItem("rxtrace_checkout_status"),
    idempotencyKey: window.localStorage.getItem("rxtrace_checkout_idempotency_key"),
  };
}

export default function SubscriptionCheckoutPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<CheckoutContextPayload | null>(null);
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [selectedPlanTemplateId, setSelectedPlanTemplateId] = useState<string>("");
  const [couponCode, setCouponCode] = useState("");

  const [structuralQty, setStructuralQty] = useState<Record<string, number>>({});
  const [variableQty, setVariableQty] = useState<Record<string, number>>({});

  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [quoteSignature, setQuoteSignature] = useState<string>("");

  const [paying, setPaying] = useState(false);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  const [checkoutStatus, setCheckoutStatus] = useState<string | null>(null);
  const [checkoutPayload, setCheckoutPayload] = useState<{ subscription: any; topup: any | null } | null>(null);
  const [lastPaidSubscriptionId, setLastPaidSubscriptionId] = useState<string | null>(null);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [savedIdempotencyKey, setSavedIdempotencyKey] = useState<string | null>(null);

  async function loadContext() {
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
  }

  useEffect(() => {
    loadContext();
    refreshSummary();
    const saved = getSavedCheckout();
    if (saved.sessionId) setCheckoutSessionId(saved.sessionId);
    if (saved.status) setCheckoutStatus(saved.status);
    if (saved.idempotencyKey) setSavedIdempotencyKey(saved.idempotencyKey);

    // Resume an in-progress checkout session without auto-opening Razorpay.
    if (saved.idempotencyKey) {
      setResumeLoading(true);
      initiateCheckout("retry", false)
        .catch(() => null)
        .finally(() => setResumeLoading(false));
    }
  }, []);

  async function refreshSummary() {
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
  }

  async function cancelAtPeriodEnd() {
    setPaying(true);
    setError(null);
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
      await refreshSummary();
      await loadContext();
    } catch (err: any) {
      setError(err?.message || "Failed to cancel subscription");
    } finally {
      setPaying(false);
    }
  }

  const { structuralAddOns, variableAddOns } = useMemo(() => {
    const addOns = context?.add_ons || [];
    const structural = addOns.filter((a) => a.addon_kind === "structural" && a.billing_mode === "recurring");
    const variable = addOns.filter((a) => a.addon_kind === "variable_quota" && a.billing_mode === "one_time");
    return { structuralAddOns: structural, variableAddOns: variable };
  }, [context]);

  const structuralSelection = useMemo(
    () =>
      Object.entries(structuralQty)
        .map(([addon_id, quantity]) => ({ addon_id, quantity: Math.max(0, Number(quantity) || 0) }))
        .filter((row) => row.quantity > 0),
    [structuralQty]
  );

  const variableSelection = useMemo(
    () =>
      Object.entries(variableQty)
        .map(([addon_id, quantity]) => ({ addon_id, quantity: Math.max(0, Number(quantity) || 0) }))
        .filter((row) => row.quantity > 0),
    [variableQty]
  );

  const selectionKey = useMemo(() => {
    const stableSort = (rows: Array<{ addon_id: string; quantity: number }>) =>
      [...rows].sort((a, b) => a.addon_id.localeCompare(b.addon_id));
    return JSON.stringify({
      plan: selectedPlanTemplateId,
      coupon: couponCode.trim().toUpperCase(),
      structural: stableSort(structuralSelection),
      variable: stableSort(variableSelection),
    });
  }, [couponCode, selectedPlanTemplateId, structuralSelection, variableSelection]);

  async function computeQuote() {
    if (!selectedPlanTemplateId) return;
    setQuoteLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/user/subscription/checkout/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_template_id: selectedPlanTemplateId,
          structural_addons: structuralSelection,
          variable_topups: variableSelection,
          coupon_code: couponCode.trim(),
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
  }

  useEffect(() => {
    if (!context) return;
    computeQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, selectionKey]);

  async function initiateCheckout(mode: "new" | "retry", autoOpenRazorpay: boolean) {
    const saved = getSavedCheckout();
    const idempotencyKey = mode === "retry" ? saved.idempotencyKey : createIdempotencyKey();

    setPaying(true);
    setError(null);
    try {
      if (!idempotencyKey) {
        throw new Error("CHECKOUT_SESSION_NOT_FOUND");
      }

      if (mode === "new") {
        if (!quote || !quoteSignature) {
          await computeQuote();
          throw new Error("QUOTE_NOT_READY");
        }

        window.localStorage.setItem("rxtrace_checkout_idempotency_key", idempotencyKey);
        window.localStorage.removeItem("rxtrace_checkout_session_id");
        window.localStorage.removeItem("rxtrace_checkout_status");
        setCheckoutSessionId(null);
        setCheckoutStatus(null);
        setCheckoutPayload(null);
      }

      const res = await fetch("/api/user/subscription/checkout/initiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(
          mode === "new"
            ? {
                quote,
                quote_signature: quoteSignature,
              }
            : {}
        ),
      });
      const payload = (await res.json()) as InitiateResponse;
      if (!res.ok || !payload.success) {
        throw new Error((payload as any).error || "Failed to initiate checkout");
      }

      setCheckoutSessionId(payload.checkout_session_id);
      setCheckoutStatus(payload.status);
      setCheckoutPayload(payload.checkout);
      window.localStorage.setItem("rxtrace_checkout_idempotency_key", idempotencyKey);
      window.localStorage.setItem("rxtrace_checkout_session_id", payload.checkout_session_id);
      window.localStorage.setItem("rxtrace_checkout_status", payload.status);

      if (autoOpenRazorpay) {
        await maybeRunRazorpayFlow({
          checkoutSessionId: payload.checkout_session_id,
          status: payload.status,
          checkout: payload.checkout,
          startAt: mode === "retry" ? "topup" : "subscription",
        });
      }
    } catch (err: any) {
      setError(err?.message || "Failed to initiate checkout");
    } finally {
      setPaying(false);
    }
  }

  async function loadRazorpayScript(): Promise<void> {
    if (window.Razorpay) return;
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
    if (!window.Razorpay) throw new Error("RAZORPAY_SDK_NOT_AVAILABLE");
  }

  async function maybeRunRazorpayFlow(params: {
    checkoutSessionId: string;
    status: string;
    checkout: { subscription: any; topup: any | null };
    startAt: "subscription" | "topup";
  }) {
    const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim() || "";
    if (!keyId) return;

    const subscriptionLeg = params.checkout.subscription || {};
    const topupLeg = params.checkout.topup || null;

    const subscriptionId = String(subscriptionLeg.razorpay_subscription_id || "").trim();
    const topupOrderId = String(topupLeg?.razorpay_order_id || "").trim();

    const shouldRunSubscription = params.startAt === "subscription";
    const shouldRunTopup = params.startAt === "topup";

    if (shouldRunSubscription && !subscriptionId) return;
    if (shouldRunTopup && topupLeg && !topupOrderId) return;

    await loadRazorpayScript();

    const openCheckout = (options: any) =>
      new Promise<{ dismissed: boolean; response: any | null }>((resolve) => {
        const rzp = new window.Razorpay({
          ...options,
          handler: (response: any) => resolve({ dismissed: false, response }),
          modal: {
            ondismiss: () => resolve({ dismissed: true, response: null }),
          },
        });
        rzp.open();
      });

    if (shouldRunSubscription) {
      const result = await openCheckout({
        key: keyId,
        subscription_id: subscriptionId,
        name: "RxTrace",
        description: "Subscription checkout",
      }).catch(() => null);

      if (!result || result.dismissed) return;
      const response = result.response || {};

      const paidSubId = String(response.razorpay_subscription_id || subscriptionId);
      setLastPaidSubscriptionId(paidSubId || null);

      const confirmSubRes = await fetch("/api/user/subscription/checkout/confirm-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkout_session_id: params.checkoutSessionId,
          subscription: {
            status: "paid",
            razorpay_subscription_id: paidSubId || null,
            razorpay_payment_id: response.razorpay_payment_id || null,
            razorpay_signature: response.razorpay_signature || null,
          },
          topup: { status: "created" },
        }),
      });
      const confirmSubPayload = await confirmSubRes.json();
      if (confirmSubRes.ok && confirmSubPayload.success) {
        setCheckoutStatus(confirmSubPayload.status);
        window.localStorage.setItem("rxtrace_checkout_status", confirmSubPayload.status);
      }

      if (!topupLeg) return;
    }

    if (shouldRunTopup && topupLeg) {
      const orderId = String(topupLeg.razorpay_order_id || "").trim();
      if (!orderId) return;

      const result = await openCheckout({
        key: keyId,
        order_id: orderId,
        name: "RxTrace",
        description: "Quota top-up",
        amount: topupLeg.amount_paise || undefined,
        currency: "INR",
      }).catch(() => null);

      if (!result || result.dismissed) {
        await fetch("/api/user/subscription/checkout/confirm-client", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            checkout_session_id: params.checkoutSessionId,
            subscription: { status: "paid", razorpay_subscription_id: lastPaidSubscriptionId || null },
            topup: { status: "failed", razorpay_order_id: orderId },
          }),
        }).catch(() => null);
        return;
      }
      const response = result.response || {};

      const confirmRes = await fetch("/api/user/subscription/checkout/confirm-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkout_session_id: params.checkoutSessionId,
          subscription: { status: "paid", razorpay_subscription_id: lastPaidSubscriptionId || null },
          topup: {
            status: "paid",
            razorpay_order_id: response.razorpay_order_id || orderId,
            razorpay_payment_id: response.razorpay_payment_id || null,
            razorpay_signature: response.razorpay_signature || null,
          },
        }),
      });
      const confirmPayload = await confirmRes.json();
      if (confirmRes.ok && confirmPayload.success) {
        setCheckoutStatus(confirmPayload.status);
        window.localStorage.setItem("rxtrace_checkout_status", confirmPayload.status);
      }
    }
  }

  const canRetryTopup =
    Boolean(checkoutPayload?.topup) &&
    (checkoutStatus === "partial_success" ||
      checkoutStatus === "subscription_paid" ||
      checkoutStatus === "topup_initiated");

  const hasSavedCheckout = Boolean(savedIdempotencyKey);

  function clearSavedCheckout() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("rxtrace_checkout_idempotency_key");
      window.localStorage.removeItem("rxtrace_checkout_session_id");
      window.localStorage.removeItem("rxtrace_checkout_status");
    }
    setCheckoutSessionId(null);
    setCheckoutStatus(null);
    setCheckoutPayload(null);
    setLastPaidSubscriptionId(null);
    setSavedIdempotencyKey(null);
  }

  const checkoutStatusHint = useMemo(() => {
    if (!checkoutStatus) return null;
    if (checkoutStatus === "partial_success") return "Subscription paid. Top-up payment pending.";
    if (checkoutStatus === "subscription_paid") return "Subscription paid. Awaiting webhook activation.";
    if (checkoutStatus === "topup_paid") return "Top-up paid. Awaiting webhook activation.";
    if (checkoutStatus === "completed") return "Checkout completed.";
    if (checkoutStatus === "failed") return "Checkout failed. You can retry.";
    if (checkoutStatus === "expired") return "Checkout session expired. Start again.";
    if (checkoutStatus === "cancelled") return "Checkout cancelled. Start again.";
    return `Status: ${checkoutStatus}`;
  }, [checkoutStatus]);

  const unifiedStatus = summary?.subscriptionStatus?.status ?? null;
  const unifiedTrialExpiresAt = summary?.subscriptionStatus?.trialExpiresAt ?? null;

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
        <p className="text-sm text-gray-500 max-w-2xl">
          Owner-only. Choose a plan, optional add-ons, and pay in one combined flow.
        </p>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Entitlements</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {summaryLoading ? (
            <p className="text-gray-500">Loading summary...</p>
          ) : summary ? (
            <>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-medium">{summary.subscription?.plan_name || "No active plan"}</p>
                  <p className="text-gray-500">
                    {summary.subscription?.billing_cycle || "-"} ·{" "}
                    {formatINRFromPaise(summary.subscription?.amount_paise || 0)}
                  </p>
                </div>
                <Badge className="bg-gray-100 text-gray-800">
                  {unifiedStatus || summary.subscription?.status || summary.entitlement.state}
                </Badge>
              </div>

              {unifiedStatus === "trial" ? (
                <p className="text-xs text-slate-600">
                  Trial active until{" "}
                  {unifiedTrialExpiresAt ? new Date(unifiedTrialExpiresAt).toLocaleDateString() : "-"}
                </p>
              ) : unifiedStatus === "expired" ? (
                <p className="text-xs text-rose-700">Trial expired. Upgrade required to continue.</p>
              ) : null}

              <div className="grid gap-2 md:grid-cols-3">
                <div>
                  <p className="text-gray-500">Current period start</p>
                  <p>{summary.subscription?.current_period_start ? new Date(summary.subscription.current_period_start).toLocaleDateString() : "-"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Current period end</p>
                  <p>{summary.subscription?.current_period_end ? new Date(summary.subscription.current_period_end).toLocaleDateString() : "-"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Next billing</p>
                  <p>{summary.subscription?.next_billing_at ? new Date(summary.subscription.next_billing_at).toLocaleDateString() : "-"}</p>
                </div>
              </div>

              {summary.subscription?.cancel_at_period_end ? (
                <p className="text-xs text-amber-700">
                  Cancellation scheduled at period end.
                </p>
              ) : (
                <div className="flex justify-end">
                  <Button
                    variant="destructive"
                    className="w-full md:w-auto"
                    onClick={cancelAtPeriodEnd}
                    disabled={paying || !(summary.subscription?.status)}
                  >
                    Cancel at Period End
                  </Button>
                </div>
              )}

              <div className="overflow-x-auto rounded-lg border border-gray-100">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-gray-400">
                    <tr>
                      <th className="px-3 py-2">Metric</th>
                      <th className="px-3 py-2">Used</th>
                      <th className="px-3 py-2">Limit</th>
                      <th className="px-3 py-2">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {["unit", "box", "carton", "pallet", "seat", "plant", "handset"].map((metric) => (
                      <tr key={metric} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-medium">{metric}</td>
                        <td className="px-3 py-2">{summary.entitlement.usage?.[metric] ?? 0}</td>
                        <td className="px-3 py-2">{summary.entitlement.limits?.[metric] ?? 0}</td>
                        <td className="px-3 py-2">{summary.entitlement.remaining?.[metric] ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">Structural Add-ons</p>
                  {summary.structural_addons?.length ? (
                    <div className="space-y-1">
                      {summary.structural_addons.map((row) => (
                        <div key={`${row.addon_id}`} className="flex items-center justify-between rounded-md border border-gray-100 bg-white px-3 py-2">
                          <div>
                            <p className="text-sm">{row.name || row.addon_id}</p>
                            <p className="text-xs text-gray-500">{row.entitlement_key}</p>
                          </div>
                          <p className="text-sm font-medium">+{row.quantity}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No active structural add-ons.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">Variable Top-up Balances</p>
                  <div className="grid gap-2 md:grid-cols-2">
                    {["unit", "box", "carton", "pallet"].map((metric) => (
                      <div key={metric} className="rounded-md border border-gray-100 bg-white px-3 py-2">
                        <p className="text-xs uppercase text-gray-400">{metric}</p>
                        <p className="text-lg font-semibold">{summary.entitlement.topups?.[metric] ?? 0}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p className="text-gray-500">Summary unavailable.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {summaryLoading ? (
            <p className="text-gray-500">Loading invoices...</p>
          ) : summary?.invoices?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-gray-400">
                  <tr>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Amount</th>
                    <th className="px-2 py-2">Issued</th>
                    <th className="px-2 py-2">Paid</th>
                    <th className="px-2 py-2">PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.invoices.map((inv) => (
                    <tr key={`${inv.created_at}:${inv.reference || ""}`} className="border-t border-gray-100">
                      <td className="px-2 py-2">{inv.status}</td>
                      <td className="px-2 py-2">
                        {inv.currency} {Number(inv.amount || 0).toFixed(2)}
                      </td>
                      <td className="px-2 py-2">{inv.issued_at ? new Date(inv.issued_at).toLocaleDateString() : "-"}</td>
                      <td className="px-2 py-2">{inv.paid_at ? new Date(inv.paid_at).toLocaleDateString() : "-"}</td>
                      <td className="px-2 py-2">
                        {inv.invoice_pdf_url ? (
                          <a className="text-blue-600 hover:underline" href={inv.invoice_pdf_url} target="_blank" rel="noreferrer">
                            Download
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-500">No invoices yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {context.current_subscription ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{context.current_subscription.plan_name || "Active subscription"}</p>
                  <p className="text-gray-500">
                    {context.current_subscription.billing_cycle || "-"} ·{" "}
                    {formatINRFromPaise(context.current_subscription.amount_paise)}
                  </p>
                </div>
                <Badge className="bg-green-100 text-green-700">{context.current_subscription.status || "active"}</Badge>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <div>
                  <p className="text-gray-500">Period start</p>
                  <p>{context.current_subscription.current_period_start ? new Date(context.current_subscription.current_period_start).toLocaleDateString() : "-"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Period end</p>
                  <p>{context.current_subscription.current_period_end ? new Date(context.current_subscription.current_period_end).toLocaleDateString() : "-"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Next billing</p>
                  <p>{context.current_subscription.next_billing_at ? new Date(context.current_subscription.next_billing_at).toLocaleDateString() : "-"}</p>
                </div>
              </div>
            </>
          ) : (
            <p className="text-gray-500">No active paid subscription found.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Combined Checkout</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">Select Plan</p>
            <div className="grid gap-3 md:grid-cols-2">
              {context.plans.map((plan) => (
                <label
                  key={plan.template_id}
                  className={`rounded-lg border p-4 cursor-pointer ${
                    selectedPlanTemplateId === plan.template_id ? "border-green-500 bg-green-50" : "border-gray-200 bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{plan.name}</p>
                      <p className="text-xs text-gray-500">
                        {plan.billing_cycle} · {formatINRFromPaise(plan.amount_paise)}
                      </p>
                    </div>
                    <input
                      type="radio"
                      name="plan"
                      checked={selectedPlanTemplateId === plan.template_id}
                      onChange={() => setSelectedPlanTemplateId(plan.template_id)}
                    />
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">Structural Add-ons (Recurring)</p>
              {structuralAddOns.length === 0 ? (
                <p className="text-sm text-gray-500">No structural add-ons configured.</p>
              ) : (
                <div className="space-y-2">
                  {structuralAddOns.map((addon) => (
                    <div key={addon.id} className="grid grid-cols-3 gap-2 items-center">
                      <p className="col-span-2 text-sm">
                        {addon.name}{" "}
                        <span className="text-xs text-gray-500">
                          (\u20B9{Number(addon.price_inr || 0).toFixed(2)}/{addon.unit})
                        </span>
                      </p>
                      <Input
                        type="number"
                        min={0}
                        value={structuralQty[addon.id] ?? 0}
                        onChange={(e) =>
                          setStructuralQty((prev) => ({ ...prev, [addon.id]: Number(e.target.value) }))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">Variable Quota Top-ups (One-time)</p>
              {variableAddOns.length === 0 ? (
                <p className="text-sm text-gray-500">No variable quota add-ons configured.</p>
              ) : (
                <div className="space-y-2">
                  {variableAddOns.map((addon) => (
                    <div key={addon.id} className="grid grid-cols-3 gap-2 items-center">
                      <p className="col-span-2 text-sm">
                        {addon.name}{" "}
                        <span className="text-xs text-gray-500">
                          (\u20B9{Number(addon.price_inr || 0).toFixed(2)}/{addon.unit})
                        </span>
                      </p>
                      <Input
                        type="number"
                        min={0}
                        value={variableQty[addon.id] ?? 0}
                        onChange={(e) =>
                          setVariableQty((prev) => ({ ...prev, [addon.id]: Number(e.target.value) }))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-700">Coupon Code</p>
              <Input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="Optional" />
              {context.eligible_coupons?.length ? (
                <p className="text-xs text-gray-500">
                  Eligible coupons: {context.eligible_coupons.map((c) => c.code).join(", ")}
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-700">Quote</p>
              {quoteLoading ? (
                <p className="text-sm text-gray-500">Calculating…</p>
              ) : quote ? (
                <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Subscription</span>
                    <span>{formatINRFromPaise(quote.totals.subscription_paise)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Structural add-ons</span>
                    <span>{formatINRFromPaise(quote.totals.structural_addons_paise)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Variable top-ups</span>
                    <span>{formatINRFromPaise(quote.totals.variable_topups_paise)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Discount</span>
                    <span>-{formatINRFromPaise(quote.totals.discount_paise)}</span>
                  </div>
                  <div className="flex justify-between font-medium pt-1">
                    <span>Total</span>
                    <span>{formatINRFromPaise(quote.totals.grand_total_paise)}</span>
                  </div>
                  <p className="text-xs text-gray-500 pt-1">Quote expires at {new Date(quote.expires_at).toLocaleTimeString()}.</p>
                </div>
              ) : (
                <p className="text-sm text-gray-500">No quote yet.</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <p className="text-xs text-gray-500">
              Payment activation is applied by Razorpay webhook verification (not by UI).
            </p>
            <Button onClick={() => initiateCheckout("new", true)} disabled={paying || quoteLoading || !selectedPlanTemplateId} className="md:w-auto w-full">
              {paying ? "Processing..." : "Pay & Activate"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {(hasSavedCheckout || resumeLoading) && (
        <Card>
          <CardHeader>
            <CardTitle>Resume Checkout</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-gray-500">
              If your payment was interrupted, you can resume the same checkout session without recalculating the quote.
            </p>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <Button
                variant="secondary"
                className="w-full md:w-auto"
                disabled={paying || resumeLoading || !hasSavedCheckout}
                onClick={() => initiateCheckout("retry", true)}
              >
                {resumeLoading ? "Resuming..." : "Resume / Retry"}
              </Button>
              <Button
                variant="ghost"
                className="w-full md:w-auto"
                disabled={paying || resumeLoading}
                onClick={clearSavedCheckout}
              >
                Clear Local Checkout
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {checkoutSessionId && (
        <Card>
          <CardHeader>
            <CardTitle>Checkout Session</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-gray-500">
                Session: <span className="font-mono text-gray-900">{checkoutSessionId}</span>
              </p>
              <Badge className="bg-gray-100 text-gray-800">{checkoutStatus || "created"}</Badge>
            </div>

            {checkoutStatusHint ? <p className="text-xs text-gray-500">{checkoutStatusHint}</p> : null}

            {checkoutPayload ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="font-medium">Subscription leg</p>
                  <p className="text-xs text-gray-500">
                    Provider payload prepared. Payment + activation will complete after Razorpay integration (Phase 5) and verified webhooks.
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="font-medium">Top-up leg</p>
                  {checkoutPayload.topup ? (
                    <>
                      <p className="text-xs text-gray-500">One-time order leg present.</p>
                      {canRetryTopup && (
                        <div className="pt-2">
                          <Button
                            variant="secondary"
                            className="w-full"
                            onClick={() => initiateCheckout("retry", true)}
                            disabled={paying}
                          >
                            Retry Top-up
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-gray-500">No top-up leg selected.</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-gray-500">Checkout payload not available yet.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
