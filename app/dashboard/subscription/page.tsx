"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  duration_days?: number | null;
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
    consumed: number;
    remaining: number;
  }>;
  capacity_table?: Array<{
    metric: string;
    subscription_allocated: number;
    addon_allocated: number;
    allocated: number;
    consumed: number;
    remaining: number;
  }>;
  decisions: {
    generation: { blocked: boolean; code: string | null };
  };
  capacity_addons: Array<{
    addon_id: string;
    name: string | null;
    entitlement_key: string | null;
    quantity: number;
    status: string;
    starts_at: string | null;
    ends_at: string | null;
    duration_days: number | null;
  }>;
  add_on_balances: Record<string, number>;
  invoices?: Array<{
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
  }>;
};

type SummaryInvoice = NonNullable<SubscriptionSummary["invoices"]>[number];

type CheckoutQuote = {
  quote_id?: string;
  expires_at: string;
  checkout_mode: "recurring_plan" | "one_time_addon";
};

type CheckoutQuoteDetails = CheckoutQuote & {
  plan_snapshot?: {
    name: string;
    billing_cycle: "monthly" | "yearly";
    plan_price_paise: number;
  };
  addons_snapshot?: {
    capacity_addons: Array<{
      addon_id: string;
      name: string;
      entitlement_key: string;
      quantity: number;
      unit_price_paise: number;
      line_total_paise: number;
      allocated_capacity: number;
    }>;
    code_addons: Array<{
      addon_id: string;
      name: string;
      entitlement_key: string;
      quantity: number;
      pricing_unit_size: number;
      allocated_quota: number;
      unit_price_paise: number;
      line_total_paise: number;
    }>;
  };
  coupon?: {
    code: string;
  } | null;
  totals: {
    subscription_paise: number;
    capacity_addons_paise: number;
    code_addons_paise: number;
    addons_paise: number;
    discount_paise: number;
    taxable_subtotal_paise: number;
    gst_rate_percent: number;
    gst_paise: number;
    final_total_paise: number;
  };
};

type QuoteApiResponse = {
  success: boolean;
  quote_id?: string;
  quote_status?: string;
  quote_expires_at?: string;
  quote?: CheckoutQuoteDetails;
  error?: string;
};

type PaymentInitiateResponse = {
  success: boolean;
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

type PendingCheckoutState = {
  title: string;
  successMessage: string;
  quoteId: string;
  quoteStatus: string;
  quoteExpiresAt: string;
  quote: CheckoutQuoteDetails;
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
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function LabelText({ text }: { text: string }) {
  return <p className="text-sm font-medium text-gray-700">{text}</p>;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-100 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 font-medium text-gray-900">{value}</p>
    </div>
  );
}

export default function SubscriptionCheckoutPage() {
  return <SubscriptionPageContent />;
}

function SubscriptionPageContent() {
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [context, setContext] = useState<CheckoutContextPayload | null>(null);
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [selectedPlanTemplateId, setSelectedPlanTemplateId] = useState("");
  const [capacityQty, setCapacityQty] = useState<Record<string, number>>({});
  const [codeQty, setCodeQty] = useState<Record<string, number>>({});
  const [couponCode, setCouponCode] = useState("");
  const [pendingCheckout, setPendingCheckout] = useState<PendingCheckoutState | null>(null);
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

  const plans = context?.plans || [];
  const addOns = context?.add_ons || [];
  const currentSubscription = summary?.subscription ?? context?.current_subscription ?? null;
  const subscriptionStatus = summary?.subscriptionStatus?.status ?? context?.subscriptionStatus?.status ?? "expired";
  const isCancelledAtPeriodEnd = Boolean(currentSubscription?.cancel_at_period_end);
  const accessBlocked = summary?.decisions?.generation?.blocked ?? false;

  const capacityCatalog = useMemo(
    () => addOns.filter((addon) => addon.addon_kind === "structural" && addon.billing_mode === "recurring"),
    [addOns]
  );
  const codeCatalog = useMemo(
    () => addOns.filter((addon) => addon.addon_kind === "variable_quota" && addon.billing_mode === "one_time"),
    [addOns]
  );

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.template_id === selectedPlanTemplateId) ?? null,
    [plans, selectedPlanTemplateId]
  );

  const currentPlanId = useMemo(() => {
    if (!context?.current_subscription?.plan_name) return null;
    const match = plans.find((plan) => plan.name === context.current_subscription?.plan_name);
    return match?.template_id ?? null;
  }, [context?.current_subscription?.plan_name, plans]);

  const selectedCapacityItems = useMemo(
    () =>
      Object.entries(capacityQty)
        .map(([addon_id, quantity]) => ({ addon_id, quantity: Math.max(0, Number(quantity) || 0) }))
        .filter((item) => item.quantity > 0),
    [capacityQty]
  );

  const selectedCodeItems = useMemo(
    () =>
      Object.entries(codeQty)
        .map(([addon_id, quantity]) => ({ addon_id, quantity: Math.max(0, Number(quantity) || 0) }))
        .filter((item) => item.quantity > 0),
    [codeQty]
  );

  const selectedCapacityPreview = useMemo(
    () =>
      selectedCapacityItems
        .map((item) => {
          const addon = capacityCatalog.find((entry) => entry.id === item.addon_id);
          return addon ? { ...addon, quantity: item.quantity, estimated_paise: Math.round(addon.price_inr * 100 * item.quantity) } : null;
        })
        .filter(Boolean) as Array<AddOn & { quantity: number; estimated_paise: number }>,
    [capacityCatalog, selectedCapacityItems]
  );

  const selectedCodePreview = useMemo(
    () =>
      selectedCodeItems
        .map((item) => {
          const addon = codeCatalog.find((entry) => entry.id === item.addon_id);
          return addon ? { ...addon, quantity: item.quantity, estimated_paise: Math.round(addon.price_inr * 100 * item.quantity) } : null;
        })
        .filter(Boolean) as Array<AddOn & { quantity: number; estimated_paise: number }>,
    [codeCatalog, selectedCodeItems]
  );

  const capacityEstimatedTotalPaise = selectedCapacityPreview.reduce((sum, row) => sum + row.estimated_paise, 0);
  const codeEstimatedTotalPaise = selectedCodePreview.reduce((sum, row) => sum + row.estimated_paise, 0);

  const buildInvoiceShareMessage = useCallback((invoice: SummaryInvoice) => {
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
      `Type: ${invoice.invoice_label}`,
      `Status: ${invoice.status || "-"}`,
      `Amount: ${amount}`,
      `Date: ${invoiceDate}`,
      absolutePdfUrl ? `PDF: ${absolutePdfUrl}` : "PDF: pending",
    ].join("\n");
  }, []);

  const openRazorpayStep = useCallback(async (
    RazorpayCtor: any,
    options: Record<string, unknown>
  ): Promise<RazorpayStepResult> => {
    return await new Promise<RazorpayStepResult>((resolve) => {
      const rzp = new RazorpayCtor({
        ...options,
        handler: (payload: Record<string, any>) => resolve({ status: "paid", payload }),
        modal: { ondismiss: () => resolve({ status: "dismissed" }) },
      });
      rzp.open();
    });
  }, []);

  const fetchQuote = useCallback(async (params: {
    planTemplateId?: string;
    capacityItems?: Array<{ addon_id: string; quantity: number }>;
    codeItems?: Array<{ addon_id: string; quantity: number }>;
    coupon?: string;
  }) => {
    const res = await fetch("/api/user/subscription/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan_id: params.planTemplateId || undefined,
        plan_template_id: params.planTemplateId || undefined,
        addons: (params.codeItems || []).map((entry) => ({ addon_id: entry.addon_id, type: "codes", quantity: entry.quantity })),
        capacity_addons: params.capacityItems || [],
        code_addons: params.codeItems || [],
        coupon_code: params.coupon || undefined,
      }),
    });
    const payload = (await res.json()) as QuoteApiResponse;
    if (!res.ok || !payload.success || !payload.quote || !payload.quote_id) {
      throw new Error(payload.error || "Failed to compute quote");
    }
    return payload;
  }, []);

  const confirmCheckout = useCallback(async (config: PendingCheckoutState) => {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const quoteId = String(config.quoteId || "");
      const quoteStatus = String(config.quoteStatus || "active").toLowerCase();
      const quoteExpiresAt = String(config.quoteExpiresAt || "");

      if (!quoteId || quoteStatus !== "active") {
        throw new Error("Quote is not active. Please refresh and try again.");
      }

      const expiresAtMs = new Date(quoteExpiresAt).getTime();
      if (Number.isNaN(expiresAtMs) || Date.now() > expiresAtMs) {
        throw new Error("Quote expired. Please review the checkout again.");
      }

      const paymentRes = await fetch("/api/user/subscription/checkout/payment/initiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ quote_id: quoteId }),
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
          description: "Subscription authentication",
        });
        if (checkoutStep.status !== "paid") {
          setMessage("Checkout closed before subscription authentication completed.");
          await refreshPageState();
          return;
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
          setMessage("Checkout closed before payment completion.");
          await refreshPageState();
          return;
        }
      }

      for (let attempt = 0; attempt < 4; attempt += 1) {
        await sleep(2500);
        await refreshPageState();
      }

      setPendingCheckout(null);
      setMessage(config.successMessage);
    } catch (err: any) {
      setError(err?.message || "Failed to initialize checkout");
    } finally {
      setSubmitting(false);
    }
  }, [openRazorpayStep, refreshPageState]);

  const prepareCheckout = useCallback(async (config: {
    planTemplateId?: string;
    capacityItems?: Array<{ addon_id: string; quantity: number }>;
    codeItems?: Array<{ addon_id: string; quantity: number }>;
    coupon?: string;
    title: string;
    successMessage: string;
  }) => {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const quotePayload = await fetchQuote(config);
      const quoteId = String(quotePayload.quote_id || "");
      const quoteStatus = String(quotePayload.quote_status || "active").toLowerCase();
      const quoteExpiresAt = String(quotePayload.quote_expires_at || quotePayload.quote?.expires_at || "");

      if (!quoteId || quoteStatus !== "active") {
        throw new Error("Quote is not active. Please refresh and try again.");
      }

      const expiresAtMs = new Date(quoteExpiresAt).getTime();
      if (Number.isNaN(expiresAtMs) || Date.now() > expiresAtMs) {
        throw new Error("Quote expired. Please try again.");
      }

      setPendingCheckout({
        title: config.title,
        successMessage: config.successMessage,
        quoteId,
        quoteStatus,
        quoteExpiresAt,
        quote: quotePayload.quote!,
      });
    } catch (err: any) {
      setError(err?.message || "Failed to prepare checkout");
    } finally {
      setSubmitting(false);
    }
  }, [fetchQuote]);

  const cancelSubscription = useCallback(async () => {
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
      setMessage(`Subscription ends on ${formatDateLabel(payload.subscription?.current_period_end || currentSubscription?.current_period_end)}.`);
      await refreshPageState();
    } catch (err: any) {
      setError(err?.message || "Failed to cancel subscription");
    } finally {
      setSubmitting(false);
    }
  }, [currentSubscription?.current_period_end, refreshPageState]);

  const startSubscription = useCallback(async (overridePlanTemplateId?: string) => {
    const targetPlanTemplateId = overridePlanTemplateId || selectedPlanTemplateId;
    if (!targetPlanTemplateId) {
      setError("Select a plan first.");
      return;
    }
    const successMessage =
      subscriptionStatus === "expired" || subscriptionStatus === "cancelled"
        ? "Plan renewal initiated. Subscription activation will continue through the provider lifecycle."
        : currentSubscription
          ? "Plan update initiated. Subscription lifecycle and local sync will continue through provider events."
          : "Subscription authentication completed. Provider activation and local sync will continue through the subscription lifecycle.";
    await prepareCheckout({
      planTemplateId: targetPlanTemplateId,
      title:
        subscriptionStatus === "expired" || subscriptionStatus === "cancelled"
          ? "Subscription Renewal Summary"
          : currentSubscription
            ? "Subscription Upgrade Summary"
            : "Subscription Summary",
      successMessage,
    });
  }, [currentSubscription, prepareCheckout, selectedPlanTemplateId, subscriptionStatus]);

  const renewSubscription = useCallback(async () => {
    const targetPlanTemplateId = currentPlanId || selectedPlanTemplateId;
    if (!targetPlanTemplateId) {
      setError("Select a plan first.");
      return;
    }
    await startSubscription(targetPlanTemplateId);
  }, [currentPlanId, selectedPlanTemplateId, startSubscription]);

  const upgradeSubscription = useCallback(async () => {
    await startSubscription(selectedPlanTemplateId);
  }, [selectedPlanTemplateId, startSubscription]);

  const buyCapacity = useCallback(async () => {
    if (!context?.current_subscription) {
      setError("An active subscription is required to buy capacity.");
      return;
    }
    if (!selectedCapacityItems.length) {
      setError("Select at least one capacity add-on.");
      return;
    }
    await prepareCheckout({
      capacityItems: selectedCapacityItems,
      title: "Capacity Add-on Summary",
      successMessage: "Payment captured. Capacity add-on activation is being completed by webhook.",
    });
  }, [context?.current_subscription, prepareCheckout, selectedCapacityItems]);

  const buyCodes = useCallback(async () => {
    if (!context?.current_subscription) {
      setError("An active subscription is required to buy code top-ups.");
      return;
    }
    if (!selectedCodeItems.length) {
      setError("Select at least one code top-up.");
      return;
    }
    await prepareCheckout({
      codeItems: selectedCodeItems,
      coupon: couponCode.trim().toUpperCase() || undefined,
      title: "Code Top-up Summary",
      successMessage: "Payment captured. Code top-up activation is being completed by webhook.",
    });
  }, [context?.current_subscription, couponCode, prepareCheckout, selectedCodeItems]);

  if (loading) return <p className="text-sm text-gray-500">Loading subscription...</p>;
  if (!context) return <p className="text-sm text-rose-600">Unable to load subscription context.</p>;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold">Subscription</h1>
        <p className="max-w-3xl text-sm text-gray-500">
          Manage your base subscription, timed capacity add-ons, stored code balances, and billing history without mixing
          them into a single checkout flow.
        </p>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      {pendingCheckout ? (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle>{pendingCheckout.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {pendingCheckout.quote.plan_snapshot?.plan_price_paise ? (
              <div className="rounded-lg border border-green-200 bg-white p-4">
                <p className="font-medium">{pendingCheckout.quote.plan_snapshot.name}</p>
                <p className="text-xs text-gray-500">
                  {pendingCheckout.quote.plan_snapshot.billing_cycle} | {formatINRFromPaise(pendingCheckout.quote.plan_snapshot.plan_price_paise)}
                </p>
              </div>
            ) : null}

            {pendingCheckout.quote.addons_snapshot?.capacity_addons?.length ? (
              <div className="space-y-2">
                <p className="font-medium text-gray-700">Capacity Add-ons</p>
                {pendingCheckout.quote.addons_snapshot.capacity_addons.map((item) => (
                  <div key={item.addon_id} className="flex items-center justify-between rounded-lg border border-green-100 bg-white px-3 py-2">
                    <p>{item.name} x {item.quantity}</p>
                    <p className="font-medium">{formatINRFromPaise(item.line_total_paise)}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {pendingCheckout.quote.addons_snapshot?.code_addons?.length ? (
              <div className="space-y-2">
                <p className="font-medium text-gray-700">Code Top-Ups</p>
                {pendingCheckout.quote.addons_snapshot.code_addons.map((item) => (
                  <div key={item.addon_id} className="flex items-center justify-between rounded-lg border border-green-100 bg-white px-3 py-2">
                    <p>{item.name} x {item.quantity}</p>
                    <p className="font-medium">{formatINRFromPaise(item.line_total_paise)}</p>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="rounded-lg border border-green-200 bg-white p-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span>Subscription Amount</span>
                  <span>{formatINRFromPaise(pendingCheckout.quote.totals.subscription_paise)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Capacity Add-ons</span>
                  <span>{formatINRFromPaise(pendingCheckout.quote.totals.capacity_addons_paise)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Code Top-Ups</span>
                  <span>{formatINRFromPaise(pendingCheckout.quote.totals.code_addons_paise)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Discount{pendingCheckout.quote.coupon?.code ? ` (${pendingCheckout.quote.coupon.code})` : ""}</span>
                  <span>-{formatINRFromPaise(pendingCheckout.quote.totals.discount_paise)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>GST {pendingCheckout.quote.totals.gst_rate_percent}%</span>
                  <span>{formatINRFromPaise(pendingCheckout.quote.totals.gst_paise)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-green-100 pt-2 font-semibold text-gray-900">
                  <span>Total Amount</span>
                  <span>{formatINRFromPaise(pendingCheckout.quote.totals.final_total_paise)}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => confirmCheckout(pendingCheckout)} disabled={submitting}>
                Proceed to Pay
              </Button>
              <Button variant="outline" onClick={() => setPendingCheckout(null)} disabled={submitting}>
                Close Summary
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {accessBlocked ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-6 text-sm text-amber-900">
            Your balances are preserved, but code generation is disabled until you renew or reactivate your subscription.
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Current Subscription</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {summaryLoading ? (
            <p className="text-gray-500">Loading subscription summary...</p>
          ) : currentSubscription ? (
            <>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-semibold">{currentSubscription.plan_name || "Subscription"}</p>
                    <Badge variant="outline">{normalizeStatusLabel(subscriptionStatus)}</Badge>
                  </div>
                  <p className="text-gray-500">
                    {currentSubscription.billing_cycle || "-"} | {formatINRFromPaise(currentSubscription.plan_price_paise || 0)}
                  </p>
                  <p className="text-gray-600">
                    {isCancelledAtPeriodEnd
                      ? `Ends on ${formatDateLabel(currentSubscription.current_period_end)}`
                      : `Active until ${formatDateLabel(currentSubscription.current_period_end)}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={renewSubscription} disabled={submitting}>
                    Renew
                  </Button>
                  <Button onClick={upgradeSubscription} disabled={submitting}>
                    Upgrade
                  </Button>
                  {!isCancelledAtPeriodEnd ? (
                    <Button variant="destructive" onClick={() => setCancelDialogOpen(true)} disabled={submitting}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <MetricCard label="Start date" value={formatDateLabel(currentSubscription.start_date)} />
                <MetricCard label="Current period end" value={formatDateLabel(currentSubscription.current_period_end)} />
                <MetricCard label="Renewal date" value={formatDateLabel(currentSubscription.renewal_date || currentSubscription.next_billing_at)} />
                <MetricCard label="Status" value={normalizeStatusLabel(currentSubscription.status)} />
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
                    {summary?.quota_table.map((row) => (
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
            </>
          ) : (
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-medium">No active subscription</p>
                <p className="text-gray-500">Start or renew a plan to enable generation and quota usage.</p>
              </div>
              <Button onClick={() => startSubscription()} disabled={submitting || !selectedPlanTemplateId}>
                {subscriptionStatus === "expired" || subscriptionStatus === "cancelled" ? "Renew" : "Start Subscription"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Available Plans</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {plans.map((plan) => {
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
                        {plan.billing_cycle} | {formatINRFromPaise(plan.plan_price_paise)}
                      </p>
                      {plan.description ? <p className="mt-2 text-sm text-gray-600">{plan.description}</p> : null}
                    </div>
                    <input type="radio" name="plan" checked={isSelected} onChange={() => setSelectedPlanTemplateId(plan.template_id)} />
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
          </div>

          {selectedPlan ? (
            <div className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{selectedPlan.name}</p>
                <p className="text-xs text-gray-500">
                  {selectedPlan.billing_cycle} | {formatINRFromPaise(selectedPlan.plan_price_paise)}
                </p>
              </div>
              <Button onClick={currentSubscription ? upgradeSubscription : () => startSubscription()} disabled={submitting}>
                {currentSubscription ? "Upgrade" : subscriptionStatus === "expired" || subscriptionStatus === "cancelled" ? "Renew" : "Start Subscription"}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Capacity Add-ons</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <p className="font-medium text-gray-700">Active Capacity Add-ons</p>
            {summary?.capacity_addons?.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {summary.capacity_addons.map((row) => (
                  <div key={row.addon_id} className="rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{row.name || row.addon_id}</p>
                        <p className="text-xs text-gray-500">{row.entitlement_key}</p>
                      </div>
                      <Badge variant="outline">+{row.quantity}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-gray-600 sm:grid-cols-3">
                      <p>Duration: {row.duration_days ? `${row.duration_days} days` : "-"}</p>
                      <p>Starts: {formatDateLabel(row.starts_at)}</p>
                      <p>Ends: {formatDateLabel(row.ends_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No active capacity add-ons.</p>
            )}
          </div>

          <div className="space-y-3">
            <p className="font-medium text-gray-700">Buy Capacity</p>
            {!context.current_subscription ? (
              <p className="text-sm text-gray-500">An active subscription is required before buying capacity add-ons.</p>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              {capacityCatalog.map((addon) => (
                <div key={addon.id} className="rounded-lg border p-4">
                  <p className="font-medium">{addon.name}</p>
                  <p className="text-xs text-gray-500">
                    {addon.entitlement_key} | {addon.duration_days || 30} days | INR {addon.price_inr}
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
            <div className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">Selected capacity add-ons</p>
                <p className="text-xs text-gray-500">
                  Estimated total {formatINRFromPaise(capacityEstimatedTotalPaise)}. Effective validity is determined by the backend end date.
                </p>
              </div>
              <Button onClick={buyCapacity} disabled={submitting || !context.current_subscription || selectedCapacityItems.length === 0}>
                Buy Capacity
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Code Top-Ups</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <p className="font-medium text-gray-700">Remaining Balances</p>
            <div className="grid gap-2 md:grid-cols-4">
              {["unit", "box", "carton", "pallet"].map((metric) => (
                <div key={metric} className="rounded border px-3 py-2">
                  <p className="text-xs uppercase text-gray-400">{metric}</p>
                  <p className="text-lg font-semibold">{summary?.add_on_balances?.[metric] ?? 0}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="font-medium text-gray-700">Buy Codes</p>
            {!context.current_subscription ? (
              <p className="text-sm text-gray-500">An active subscription is required before buying code top-ups.</p>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              {codeCatalog.map((addon) => (
                <div key={addon.id} className="rounded-lg border p-4">
                  <p className="font-medium">{addon.name}</p>
                  <p className="text-xs text-gray-500">
                    {addon.entitlement_key} | 1 unit = {addon.pricing_unit_size.toLocaleString()} codes | INR {addon.price_inr}
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

            <div className="space-y-3 rounded-lg border border-gray-200 p-4">
              <div className="space-y-1">
                <LabelText text="Coupon" />
                <Input value={couponCode} placeholder="Enter coupon code" onChange={(e) => setCouponCode(e.target.value.toUpperCase())} />
                <p className="text-xs text-gray-500">Coupons are applied by backend pricing during code top-up checkout.</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">Selected code top-ups</p>
                  <p className="text-xs text-gray-500">Estimated total {formatINRFromPaise(codeEstimatedTotalPaise)} before backend tax and discount.</p>
                </div>
                <Button onClick={buyCodes} disabled={submitting || !context.current_subscription || selectedCodeItems.length === 0}>
                  Buy Codes
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billing History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!summary?.invoices?.length ? (
            <p className="text-gray-500">No invoices yet.</p>
          ) : (
            summary.invoices.map((invoice, idx) => (
              <div key={`${invoice.reference || "invoice"}-${idx}`} className="flex flex-col gap-3 rounded border p-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-medium">{invoice.reference || "Invoice"}</p>
                  <p className="text-xs text-gray-500">
                    {invoice.invoice_label} | {invoice.status} | {invoice.created_at ? new Date(invoice.created_at).toLocaleDateString("en-IN") : "-"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <p className="font-semibold">INR {Number(invoice.amount || 0).toFixed(2)}</p>
                  {invoice.invoice_pdf_url ? (
                    <a href={invoice.invoice_pdf_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-blue-600 hover:underline">
                      Download PDF
                    </a>
                  ) : (
                    <span className="text-xs text-gray-500">PDF pending</span>
                  )}
                  <Button asChild type="button" variant="outline" className="h-8 px-2 text-xs">
                    <a href={`https://wa.me/?text=${encodeURIComponent(buildInvoiceShareMessage(invoice))}`} target="_blank" rel="noopener noreferrer">
                      WhatsApp
                    </a>
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              Your subscription will remain active until {formatDateLabel(currentSubscription?.current_period_end)}.
              After this date, the subscription will expire. You can renew or upgrade later from the subscription page.
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
