"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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
  capacity_table?: Array<{
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
  invoices?: Array<{
    id: string;
    invoice_type: string;
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
  }>;
};

type SummaryInvoice = NonNullable<SubscriptionSummary["invoices"]>[number];

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
  quote_id?: string;
  expires_at: string;
  checkout_mode: "recurring_plan" | "one_time_addon";
  plan_snapshot?: {
    name: string;
    description: string | null;
    billing_cycle: "monthly" | "yearly";
    plan_price_paise: number;
    pricing_unit_size: number;
    quota_units: Record<string, number>;
    quotas: Record<string, number>;
    capacities: Record<string, number>;
  };
  addons_snapshot?: {
    capacity_addons: QuoteLine[];
    code_addons: QuoteLine[];
  };
  discount_paise?: number;
  gst_paise?: number;
  final_total_paise?: number;
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
  coupon: null | {
    id: string;
    code: string;
    discount_type: "percentage" | "flat";
    discount_value: number;
    max_discount_paise: number | null;
  };
  totals: {
    currency: "INR";
    subscription_paise: number;
    capacity_addons_paise: number;
    code_addons_paise: number;
    addons_paise: number;
    discount_paise: number;
    taxable_subtotal_paise: number;
    gst_rate_percent: number;
    gst_paise: number;
    addons_payable_paise: number;
    payable_today_paise: number;
    grand_total_paise: number;
    final_total_paise: number;
  };
};

type PaymentInitiateResponse = {
  success: boolean;
  quote_id?: string;
  payment_intent_id?: string;
  order_id?: string | null;
  subscription_id?: string | null;
  checkout_mode?: "recurring_plan" | "one_time_addon";
  razorpay: {
    key_id: string | null;
    order_id?: string;
    subscription_id?: string;
    amount_paise?: number;
    currency: string;
  };
};

type RazorpayStepResult =
  | { status: "paid"; payload: Record<string, any> }
  | { status: "dismissed" };

type QuoteApiResponse = {
  success: boolean;
  quote_id?: string;
  quote_status?: string;
  quote_expires_at?: string;
  quote?: CheckoutQuote;
  error?: string;
};

function formatINRFromPaise(paise: number) {
  const inr = (Number(paise || 0) / 100).toFixed(2);
  return `\u20B9${inr}`;
}

function quoteHasAnyAddons(quote: CheckoutQuote | null | undefined) {
  if (!quote) return false;
  const codeCount = (quote.addons_snapshot?.code_addons?.length || quote.code_addons.length || 0);
  const capacityCount = (quote.addons_snapshot?.capacity_addons?.length || quote.capacity_addons.length || 0);
  return codeCount + capacityCount > 0;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const [couponCode, setCouponCode] = useState("");
  const [appliedCouponCode, setAppliedCouponCode] = useState("");

  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [quoteId, setQuoteId] = useState<string>("");
  const [quoteStatus, setQuoteStatus] = useState<string>("");
  const [quoteExpiresAt, setQuoteExpiresAt] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const quoteRequestSeqRef = useRef(0);
  const quoteAbortRef = useRef<AbortController | null>(null);

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

  const refreshCheckoutState = useCallback(async () => {
    await Promise.all([refreshSummary(), loadContext()]);
  }, [loadContext, refreshSummary]);

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
      coupon: appliedCouponCode,
    });
  }, [appliedCouponCode, capacitySelection, codeSelection, selectedPlanTemplateId]);
  const deferredSelectionKey = useDeferredValue(selectionKey);

  const computeQuote = useCallback(async () => {
    if (!selectedPlanTemplateId) return;
    quoteAbortRef.current?.abort();
    const controller = new AbortController();
    quoteAbortRef.current = controller;
    const requestSeq = quoteRequestSeqRef.current + 1;
    quoteRequestSeqRef.current = requestSeq;

    setQuoteLoading(true);
    setError(null);
    setQuote(null);
    setQuoteId("");
    setQuoteStatus("");
    setQuoteExpiresAt("");
    try {
      const res = await fetch("/api/user/subscription/checkout/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          plan_id: selectedPlanTemplateId,
          plan_template_id: selectedPlanTemplateId,
          addons: codeSelection.map((entry) => ({ addon_id: entry.addon_id, type: "codes", quantity: entry.quantity })),
          capacity_addons: capacitySelection,
          code_addons: codeSelection,
          coupon_code: appliedCouponCode || undefined,
        }),
      });
      const payload = (await res.json()) as QuoteApiResponse;
      if (!res.ok || !payload.success || !payload.quote || !payload.quote_id) {
        throw new Error(payload.error || "Failed to compute quote");
      }
      if (quoteRequestSeqRef.current !== requestSeq) return;
      setQuote(payload.quote);
      setQuoteId(String(payload.quote_id));
      setQuoteStatus(String(payload.quote_status || "active").toLowerCase());
      setQuoteExpiresAt(String(payload.quote_expires_at || payload.quote.expires_at || ""));
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      if (quoteRequestSeqRef.current !== requestSeq) return;
      setQuote(null);
      setQuoteId("");
      setQuoteStatus("");
      setQuoteExpiresAt("");
      setError(err?.message || "Failed to compute quote");
    } finally {
      if (quoteRequestSeqRef.current !== requestSeq) return;
      setQuoteLoading(false);
    }
  }, [appliedCouponCode, capacitySelection, codeSelection, selectedPlanTemplateId]);

  useEffect(() => {
    if (!context) return;
    const timer = window.setTimeout(() => {
      computeQuote().catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [context, computeQuote, deferredSelectionKey]);

  useEffect(() => {
    return () => {
      quoteAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!quoteId || !quoteExpiresAt || quoteLoading) return;
    const expiryTs = new Date(quoteExpiresAt).getTime();
    if (Number.isNaN(expiryTs)) return;
    const delay = expiryTs - Date.now();
    if (delay <= 0) {
      setMessage("Quote expired, refreshing...");
      computeQuote();
      return;
    }
    const timer = setTimeout(() => {
      setMessage("Quote expired, refreshing...");
      computeQuote();
    }, delay + 25);
    return () => clearTimeout(timer);
  }, [quoteId, quoteExpiresAt, quoteLoading, computeQuote]);

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
      await refreshCheckoutState();
    } catch (err: any) {
      setError(err?.message || "Failed to cancel subscription");
    } finally {
      setSubmitting(false);
    }
  }

  async function applyCoupon() {
    if (!couponCode.trim()) {
      setError("Enter a coupon code.");
      setAppliedCouponCode("");
      return;
    }
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      if (!quote || quote.totals.addons_paise <= 0) {
        throw new Error("Add-ons are required to apply a coupon.");
      }
      const res = await fetch("/api/user/coupons/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: couponCode.trim(),
          subscription_amount_paise: quote.totals.subscription_paise,
          addons_amount_paise: quote.totals.addons_paise,
        }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || "Coupon could not be applied");
      }
      const normalizedCode = String(payload.coupon?.code || couponCode.trim()).toUpperCase();
      setCouponCode(normalizedCode);
      setAppliedCouponCode(normalizedCode);
      setMessage("Coupon applied.");
    } catch (err: any) {
      setAppliedCouponCode("");
      setError(err?.message || "Coupon could not be applied");
    } finally {
      setSubmitting(false);
    }
  }

  function removeCoupon() {
    setCouponCode("");
    setAppliedCouponCode("");
    setError(null);
    setMessage("Coupon removed. Refreshing quote...");
  }

  function buildInvoiceShareMessage(invoice: SummaryInvoice) {
    const reference = invoice.reference || invoice.id || "Invoice";
    const invoiceDate = invoice.created_at ? new Date(invoice.created_at).toLocaleDateString("en-IN") : "-";
    const amount = `INR ${Number(invoice.amount || 0).toFixed(2)}`;
    const pdfUrl = String(invoice.invoice_pdf_url || "").trim();
    const absolutePdfUrl =
      pdfUrl && pdfUrl.startsWith("/") && typeof window !== "undefined"
        ? `${window.location.origin}${pdfUrl}`
        : pdfUrl;

    return [
      `RxTrace invoice: ${reference}`,
      `Status: ${invoice.status || "-"}`,
      `Amount: ${amount}`,
      `Date: ${invoiceDate}`,
      absolutePdfUrl ? `PDF: ${absolutePdfUrl}` : "PDF: pending",
    ].join("\n");
  }


  async function openRazorpayStep(
    RazorpayCtor: any,
    options: Record<string, unknown>
  ): Promise<RazorpayStepResult> {
    return await new Promise<RazorpayStepResult>((resolve) => {
      const rzp = new RazorpayCtor({
        ...options,
        handler: (payload: Record<string, any>) => resolve({ status: "paid", payload }),
        modal: { ondismiss: () => resolve({ status: "dismissed" }) },
      });
      rzp.open();
    });
  }

  async function initiateCheckout() {
    await initiatePayment(false);
  }

  async function fetchFreshQuote(addonsOnly: boolean): Promise<QuoteApiResponse> {
    const res = await fetch("/api/user/subscription/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan_id: addonsOnly ? undefined : selectedPlanTemplateId,
        plan_template_id: addonsOnly ? undefined : selectedPlanTemplateId,
        addons: codeSelection.map((entry) => ({ addon_id: entry.addon_id, type: "codes", quantity: entry.quantity })),
        capacity_addons: capacitySelection,
        code_addons: codeSelection,
        coupon_code: appliedCouponCode || undefined,
      }),
    });
    const payload = (await res.json()) as QuoteApiResponse;
    if (!res.ok || !payload.success || !payload.quote_id || !payload.quote) {
      throw new Error(payload.error || "Failed to compute quote");
    }
    return payload;
  }

  async function initiatePayment(addonsOnly: boolean) {
    if ((!addonsOnly && !selectedPlanTemplateId) || quoteLoading) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      let effectiveQuoteId = quoteId;
      let effectiveQuote = quote;
      let effectiveQuoteStatus = quoteStatus;
      let effectiveQuoteExpiresAt = quoteExpiresAt || quote?.expires_at || "";

      if (addonsOnly) {
        if (!context?.current_subscription) {
          throw new Error("Active subscription is required for add-ons only checkout.");
        }
        const refreshed = await fetchFreshQuote(true);
        effectiveQuoteId = String(refreshed.quote_id || "");
        effectiveQuote = refreshed.quote || null;
        effectiveQuoteStatus = String(refreshed.quote_status || "active").toLowerCase();
        effectiveQuoteExpiresAt = String(refreshed.quote_expires_at || refreshed.quote?.expires_at || "");
      }

      if (!effectiveQuoteId || !effectiveQuote) {
        throw new Error("QUOTE_NOT_AVAILABLE");
      }
      if (!addonsOnly && effectiveQuote.checkout_mode === "recurring_plan" && quoteHasAnyAddons(effectiveQuote)) {
        throw new Error(
          "Recurring plan checkout must be completed without add-ons. Purchase the plan first, then buy add-ons separately after activation."
        );
      }
      const expiresAtMs = new Date(effectiveQuoteExpiresAt).getTime();
      const expired = Number.isNaN(expiresAtMs) || Date.now() > expiresAtMs;
      if (expired) {
        setMessage("Quote expired, refreshing...");
        await computeQuote();
        return;
      }
      if (effectiveQuoteStatus !== "active") {
        setError("Quote is not active. Please refresh.");
        await computeQuote();
        return;
      }

      const paymentRes = await fetch("/api/user/subscription/checkout/payment/initiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ quote_id: effectiveQuoteId }),
      });
      const paymentPayload = (await paymentRes.json()) as PaymentInitiateResponse;
      if (!paymentRes.ok || !paymentPayload.success) {
        throw new Error((paymentPayload as any).error || "Failed to initialize Razorpay checkout");
      }

      await loadRazorpayScript();
      const RazorpayCtor = (window as any).Razorpay;

      if (paymentPayload.razorpay.subscription_id) {
        const checkoutStep = await openRazorpayStep(RazorpayCtor, {
          key: paymentPayload.razorpay.key_id,
          subscription_id: paymentPayload.razorpay.subscription_id,
          amount: paymentPayload.razorpay.amount_paise || 0,
          currency: paymentPayload.razorpay.currency || "INR",
          name: "RxTrace",
          description: "Recurring subscription authentication",
        });
        if (checkoutStep.status !== "paid") {
          setMessage("Recurring subscription checkout was closed before authentication completed.");
          await refreshCheckoutState();
          return;
        }

        for (let attempt = 0; attempt < 4; attempt += 1) {
          await sleep(2500);
          await refreshCheckoutState();
        }
      } else if (paymentPayload.razorpay.order_id) {
        const checkoutStep = await openRazorpayStep(RazorpayCtor, {
          key: paymentPayload.razorpay.key_id,
          order_id: paymentPayload.razorpay.order_id,
          amount: paymentPayload.razorpay.amount_paise || 0,
          currency: paymentPayload.razorpay.currency || "INR",
          name: "RxTrace",
          description: "Checkout payment",
        });
        if (checkoutStep.status !== "paid") {
          setMessage("Checkout was closed before payment completion.");
          await refreshCheckoutState();
          return;
        }

        for (let attempt = 0; attempt < 4; attempt += 1) {
          await sleep(2500);
          await refreshCheckoutState();
        }
      }

      setMessage(
        addonsOnly
          ? "Payment captured. Add-on activation is being completed by webhook."
          : "Subscription authentication completed. Provider activation and local sync will continue through the subscription lifecycle."
      );
      await refreshCheckoutState();
    } catch (err: any) {
      setError(err?.message || "Failed to initialize checkout");
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

              <div className="overflow-x-auto rounded-lg border border-gray-100">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-gray-400">
                    <tr>
                      <th className="px-3 py-2">Capacity</th>
                      <th className="px-3 py-2">Plan</th>
                      <th className="px-3 py-2">Add-ons</th>
                      <th className="px-3 py-2">Total</th>
                      <th className="px-3 py-2">Used</th>
                      <th className="px-3 py-2">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(summary.capacity_table || []).map((row) => (
                      <tr key={row.metric} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-medium capitalize">{row.metric}s</td>
                        <td className="px-3 py-2">{row.subscription_allocated.toLocaleString()}</td>
                        <td className="px-3 py-2">{row.addon_allocated.toLocaleString()}</td>
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
          <CardTitle>One-time Add-ons</CardTitle>
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
                <p className="font-medium">Recurring Plan</p>
                <div className="mt-2 flex items-center justify-between">
                  <div>
                    <p>{quote.plan_snapshot?.name || quote.plan.name}</p>
                    <p className="text-gray-500">{quote.plan_snapshot?.billing_cycle || quote.plan.billing_cycle} recurring</p>
                  </div>
                  <span>{formatINRFromPaise(quote.plan_snapshot?.plan_price_paise || quote.plan.plan_price_paise)}</span>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <p className="font-medium">One-time Add-ons</p>
                {(quote.addons_snapshot?.code_addons?.length || quote.code_addons.length) ||
                (quote.addons_snapshot?.capacity_addons?.length || quote.capacity_addons.length) ? (
                  <div className="mt-2 space-y-2">
                    {(quote.addons_snapshot?.code_addons || quote.code_addons).map((line) => (
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
                    {(quote.addons_snapshot?.capacity_addons || quote.capacity_addons).map((line) => (
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
                  <p className="mt-2 text-gray-500">No add-ons selected.</p>
                )}
              </div>

              <div className="rounded-lg border p-4">
                <p className="font-medium">Coupon</p>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  <Input
                    value={couponCode}
                    placeholder="Enter coupon code"
                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={applyCoupon}
                    disabled={submitting || quoteLoading || !quote || quote.totals.addons_paise <= 0}
                  >
                    Apply Coupon
                  </Button>
                  {appliedCouponCode ? (
                    <Button type="button" variant="ghost" onClick={removeCoupon} disabled={submitting}>
                      Remove
                    </Button>
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-gray-500">Coupons are applied by backend pricing and frozen into quote snapshot.</p>
                {quote.coupon ? <p className="mt-2 text-xs text-emerald-700">Applied: {quote.coupon.code}</p> : null}
              </div>

              <div className="rounded-lg border p-4">
                <p className="font-medium">Checkout Summary</p>
                <div className="flex items-center justify-between">
                  <span>Plan</span>
                  <span>{formatINRFromPaise(quote.totals.subscription_paise)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span>Add-ons</span>
                  <span>{formatINRFromPaise(quote.totals.addons_paise)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-emerald-700">
                  <span>Discount</span>
                  <span>-{formatINRFromPaise(quote.discount_paise ?? quote.totals.discount_paise)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span>Taxable subtotal</span>
                  <span>{formatINRFromPaise(quote.totals.taxable_subtotal_paise)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span>GST ({quote.totals.gst_rate_percent}%)</span>
                  <span>{formatINRFromPaise(quote.gst_paise ?? quote.totals.gst_paise)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between border-t pt-3 font-semibold">
                  <span>Final total</span>
                  <span>{formatINRFromPaise(quote.final_total_paise ?? quote.totals.final_total_paise)}</span>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-gray-500">
                  {quote.checkout_mode === "one_time_addon"
                    ? "Razorpay one-time checkout will open for the final total shown above."
                    : quoteHasAnyAddons(quote)
                      ? "Recurring plans with add-ons must be split. Buy the plan first, then purchase add-ons separately after activation."
                      : "Razorpay subscription checkout will open to authenticate the recurring plan."}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    onClick={initiateCheckout}
                    disabled={
                      submitting ||
                      quoteLoading ||
                      !quote ||
                      !quoteId ||
                      quoteStatus !== "active" ||
                      (quote.checkout_mode === "recurring_plan" && quoteHasAnyAddons(quote)) ||
                      !quoteExpiresAt ||
                      Date.now() > new Date(quoteExpiresAt).getTime()
                    }
                  >
                    {quote.checkout_mode === "one_time_addon"
                      ? "Proceed to Payment"
                      : quoteHasAnyAddons(quote)
                        ? "Split Plan And Add-ons"
                        : "Start Recurring Checkout"}
                  </Button>
                  {context.current_subscription && quote && quote.totals.addons_paise > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => initiatePayment(true)}
                      disabled={submitting || quoteLoading}
                    >
                      Buy Add-ons Only
                    </Button>
                  ) : null}
                </div>
              </div>
              {quoteId ? (
                <p className="text-xs text-gray-500">
                  Quote ID: {quoteId} | Mode: {quote.checkout_mode} | Status: {quoteStatus || "active"} | Expires:{" "}
                  {quoteExpiresAt ? new Date(quoteExpiresAt).toLocaleTimeString() : "-"}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-gray-500">{quoteLoading ? "Refreshing quote..." : "Select a plan to view checkout details."}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!summary?.invoices?.length ? (
            <p className="text-gray-500">No invoices yet.</p>
          ) : (
            summary.invoices.map((invoice, idx) => (
              <div key={`${invoice.reference || "invoice"}-${idx}`} className="flex items-center justify-between rounded border p-3">
                <div>
                  <p className="font-medium">{invoice.reference || "Invoice"}</p>
                  <p className="text-xs text-gray-500">
                    {invoice.plan || invoice.invoice_type} · {invoice.status} · {invoice.created_at ? new Date(invoice.created_at).toLocaleDateString() : "-"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="font-semibold">INR {Number(invoice.amount || 0).toFixed(2)}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {invoice.invoice_pdf_url ? (
                      <a
                        href={invoice.invoice_pdf_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-blue-600 hover:underline"
                      >
                        Download PDF
                      </a>
                    ) : (
                      <span className="text-xs text-gray-500">PDF pending</span>
                    )}
                    <Button asChild type="button" variant="outline" className="h-8 px-2 text-xs">
                      <a
                        href={`https://wa.me/?text=${encodeURIComponent(buildInvoiceShareMessage(invoice))}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        WhatsApp
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LabelText({ text }: { text: string }) {
  return <p className="text-sm font-medium text-gray-700">{text}</p>;
}
