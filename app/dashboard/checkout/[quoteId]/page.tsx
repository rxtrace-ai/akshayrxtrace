"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, RefreshCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type CheckoutQuoteDetails = {
  quote_id: string;
  expires_at: string;
  checkout_mode: "recurring_plan" | "one_time_addon";
  purchase_type: "subscription" | "capacity_addon" | "code_topup" | "mixed_addons";
  selected_plan_template_id?: string | null;
  plan_snapshot?: {
    name: string;
    billing_cycle: "monthly" | "yearly";
    plan_price_paise: number;
    quotas?: Record<string, number>;
    capacities?: Record<string, number>;
  } | null;
  addons_snapshot: {
    capacity_addons: Array<{
      addon_id: string;
      name: string;
      entitlement_key: string;
      quantity: number;
      duration_days?: number | null;
      allocated_capacity: number;
      unit_price_paise: number;
      line_total_paise: number;
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
    currency: string;
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

type QuoteResponse = {
  success: boolean;
  quote_id: string;
  quote_status: string;
  quote_expires_at: string;
  quote: CheckoutQuoteDetails;
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

function formatINRFromPaise(paise: number) {
  return `\u20B9${(Number(paise || 0) / 100).toFixed(2)}`;
}

function formatDateLabel(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function purchaseTypeLabel(value: CheckoutQuoteDetails["purchase_type"]) {
  switch (value) {
    case "subscription":
      return "Subscription Purchase";
    case "capacity_addon":
      return "Capacity Add-on";
    case "code_topup":
      return "Code Top-up";
    default:
      return "Add-on Purchase";
  }
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

export default function CheckoutPage() {
  const params = useParams<{ quoteId: string }>();
  const router = useRouter();
  const quoteId = String(params?.quoteId || "");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [couponCode, setCouponCode] = useState("");

  const loadQuote = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/user/subscription/checkout/quote/${quoteId}`, { cache: "no-store" });
    const payload = (await res.json()) as QuoteResponse;
    if (!res.ok || !payload.success) {
      throw new Error(payload.error || "Failed to load checkout quote");
    }
    setQuote(payload);
    setCouponCode(payload.quote.coupon?.code || "");
    setLoading(false);
  }, [quoteId]);

  useEffect(() => {
    loadQuote().catch((err: any) => {
      setError(err?.message || "Failed to load checkout");
      setLoading(false);
    });
  }, [loadQuote]);

  const backHref = useMemo(() => {
    if (!quote?.quote) return "/dashboard/subscription";
    return quote.quote.purchase_type === "subscription" ? "/dashboard/subscription" : "/dashboard/add-ons";
  }, [quote]);

  const quoteData = quote?.quote;
  const isQuoteActive = String(quote?.quote_status || "").toLowerCase() === "active";

  const regenerateQuote = useCallback(async () => {
    if (!quoteData) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/user/subscription/checkout/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: quoteData.selected_plan_template_id || undefined,
          plan_template_id: quoteData.selected_plan_template_id || undefined,
          capacity_addons: quoteData.addons_snapshot.capacity_addons.map((item) => ({
            addon_id: item.addon_id,
            quantity: item.quantity,
          })),
          code_addons: quoteData.addons_snapshot.code_addons.map((item) => ({
            addon_id: item.addon_id,
            quantity: item.quantity,
          })),
          addons: quoteData.addons_snapshot.code_addons.map((item) => ({
            addon_id: item.addon_id,
            type: "codes",
            quantity: item.quantity,
          })),
          coupon_code: couponCode.trim().toUpperCase() || undefined,
        }),
      });
      const payload = (await res.json()) as { success: boolean; quote_id?: string; error?: string };
      if (!res.ok || !payload.success || !payload.quote_id) {
        throw new Error(payload.error || "Failed to refresh checkout");
      }
      router.replace(`/dashboard/checkout/${payload.quote_id}`);
    } catch (err: any) {
      setError(err?.message || "Failed to refresh checkout");
      setSubmitting(false);
    }
  }, [couponCode, quoteData, router]);

  const applyCoupon = useCallback(async () => {
    if (!quoteData) return;
    await regenerateQuote();
  }, [quoteData, regenerateQuote]);

  const confirmCheckout = useCallback(async () => {
    if (!quote) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const quoteStatus = String(quote.quote_status || "active").toLowerCase();
      const quoteExpiresAt = String(quote.quote_expires_at || "");

      if (quoteStatus !== "active") {
        throw new Error("Quote is not active. Please go back and create a new checkout.");
      }

      const expiresAtMs = new Date(quoteExpiresAt).getTime();
      if (Number.isNaN(expiresAtMs) || Date.now() > expiresAtMs) {
        throw new Error("Quote expired. Please return and generate a fresh checkout.");
      }

      const paymentRes = await fetch("/api/user/subscription/checkout/payment/initiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ quote_id: quote.quote_id }),
      });
      const paymentPayload = (await paymentRes.json()) as PaymentInitiateResponse;
      if (!paymentRes.ok || !paymentPayload.success) {
        throw new Error((paymentPayload as any).error || "Failed to initialize Razorpay checkout");
      }

      await loadRazorpayScript();
      const RazorpayCtor = (window as any).Razorpay;

      const result = await new Promise<"paid" | "dismissed">((resolve) => {
        const rzp = new RazorpayCtor({
          key: paymentPayload.razorpay.key_id,
          order_id: paymentPayload.razorpay.order_id,
          subscription_id: paymentPayload.razorpay.subscription_id,
          amount: paymentPayload.razorpay.amount_paise || 0,
          currency: paymentPayload.razorpay.currency || "INR",
          name: "RxTrace",
          description: purchaseTypeLabel(quote.quote.purchase_type),
          handler: () => resolve("paid"),
          modal: { ondismiss: () => resolve("dismissed") },
        });
        rzp.open();
      });

      if (result !== "paid") {
        setMessage("Checkout closed before payment completion.");
        return;
      }

      for (let attempt = 0; attempt < 4; attempt += 1) {
        await sleep(2500);
      }

      setMessage("Payment captured. Finalization is being completed in the background. Redirecting you back now.");
      setTimeout(() => {
        router.push(backHref);
      }, 1200);
    } catch (err: any) {
      setError(err?.message || "Failed to complete checkout");
    } finally {
      setSubmitting(false);
    }
  }, [backHref, quote, router]);

  if (loading) return <p className="text-sm text-slate-500">Loading checkout...</p>;
  if (!quoteData) return <p className="text-sm text-rose-600">Unable to load checkout details.</p>;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-2 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" className="pl-0 text-slate-600 hover:text-slate-950">
          <Link href={backHref}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={regenerateQuote} disabled={submitting}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Refresh Quote
          </Button>
          <Badge variant="outline">{purchaseTypeLabel(quoteData.purchase_type)}</Badge>
        </div>
      </div>

      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.12),_transparent_35%),linear-gradient(135deg,#ffffff_0%,#f8fafc_100%)] p-8">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Checkout summary</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          This page is quote-driven. Pricing, discount eligibility, taxable subtotal, GST, and final amount all come from the
          backend and are shown here as the billing source of truth.
        </p>
        <div className="mt-6 flex flex-wrap gap-6 text-sm text-slate-500">
          <p>Quote ID: <span className="font-medium text-slate-700">{quote.quote_id}</span></p>
          <p>Expires: <span className="font-medium text-slate-700">{formatDateLabel(quote.quote_expires_at)}</span></p>
          <p>Status: <span className="font-medium capitalize text-slate-700">{quote.quote_status}</span></p>
        </div>
      </section>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {!isQuoteActive ? (
        <Card className="rounded-[28px] border-amber-200 bg-amber-50">
          <CardContent className="flex flex-col gap-4 pt-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold text-amber-950">This quote is no longer active.</p>
              <p className="text-sm text-amber-800">
                Refresh the quote to get current pricing, coupon eligibility, and a valid checkout window before paying.
              </p>
            </div>
            <Button onClick={regenerateQuote} disabled={submitting}>
              Create Fresh Quote
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-[28px] border-slate-200">
          <CardHeader>
            <CardTitle>Selected Items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {quoteData.plan_snapshot ? (
              <div className="rounded-[24px] border border-slate-200 bg-white p-5">
                <p className="text-lg font-semibold text-slate-950">{quoteData.plan_snapshot.name}</p>
                <p className="text-sm text-slate-500">
                  {quoteData.plan_snapshot.billing_cycle} | {formatINRFromPaise(quoteData.plan_snapshot.plan_price_paise)}
                </p>
              </div>
            ) : null}

            {quoteData.addons_snapshot.capacity_addons.length ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">Capacity add-ons</p>
                {quoteData.addons_snapshot.capacity_addons.map((item) => (
                  <div key={`capacity-${item.addon_id}`} className="rounded-[24px] border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-950">{item.name}</p>
                        <p className="text-sm text-slate-500">
                          {item.entitlement_key} | Qty {item.quantity}
                          {item.duration_days ? ` | ${item.duration_days} days` : ""}
                        </p>
                      </div>
                      <p className="font-semibold text-slate-950">{formatINRFromPaise(item.line_total_paise)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {quoteData.addons_snapshot.code_addons.length ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">Code top-ups</p>
                {quoteData.addons_snapshot.code_addons.map((item) => (
                  <div key={`code-${item.addon_id}`} className="rounded-[24px] border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-950">{item.name}</p>
                        <p className="text-sm text-slate-500">
                          {item.entitlement_key} | Qty {item.quantity} | {item.allocated_quota.toLocaleString()} codes
                        </p>
                      </div>
                      <p className="font-semibold text-slate-950">{formatINRFromPaise(item.line_total_paise)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-slate-200">
          <CardHeader>
            <CardTitle>Payment Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3 rounded-[24px] border border-slate-200 bg-slate-50/80 p-5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Subscription subtotal</span>
                <span className="font-medium text-slate-950">{formatINRFromPaise(quoteData.totals.subscription_paise)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Capacity add-ons</span>
                <span className="font-medium text-slate-950">{formatINRFromPaise(quoteData.totals.capacity_addons_paise)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Code top-ups</span>
                <span className="font-medium text-slate-950">{formatINRFromPaise(quoteData.totals.code_addons_paise)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">
                  Discount{quoteData.coupon?.code ? ` (${quoteData.coupon.code})` : ""}
                </span>
                <span className="font-medium text-slate-950">-{formatINRFromPaise(quoteData.totals.discount_paise)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Taxable subtotal</span>
                <span className="font-medium text-slate-950">{formatINRFromPaise(quoteData.totals.taxable_subtotal_paise)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">GST {quoteData.totals.gst_rate_percent}%</span>
                <span className="font-medium text-slate-950">{formatINRFromPaise(quoteData.totals.gst_paise)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-base font-semibold text-slate-950">
                <span>Final total</span>
                <span>{formatINRFromPaise(quoteData.totals.final_total_paise)}</span>
              </div>
            </div>

            <div className="space-y-3 rounded-[24px] border border-slate-200 bg-white p-5">
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700">Coupon</label>
                <Input value={couponCode} placeholder="Enter coupon code" onChange={(e) => setCouponCode(e.target.value.toUpperCase())} />
                <p className="text-xs text-slate-500">Coupon eligibility is validated by backend quote generation. The UI only reflects the result.</p>
              </div>
              <Button variant="outline" onClick={applyCoupon} disabled={submitting || !isQuoteActive}>
                Apply Coupon
              </Button>
            </div>

            <Button className="w-full" onClick={confirmCheckout} disabled={submitting || !isQuoteActive}>
              Pay Now
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
