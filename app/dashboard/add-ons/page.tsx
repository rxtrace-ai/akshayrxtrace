"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

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
  add_ons: AddOn[];
  current_subscription: null | {
    id: string;
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
  addon_invoices?: SummaryInvoice[];
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

function LabelText({ text }: { text: string }) {
  return <p className="text-sm font-medium text-slate-700">{text}</p>;
}

export default function AddOnsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<CheckoutContextPayload | null>(null);
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [capacityQty, setCapacityQty] = useState<Record<string, number>>({});
  const [codeQty, setCodeQty] = useState<Record<string, number>>({});

  const refreshPageState = useCallback(async () => {
    setLoading(true);
    const [contextRes, summaryRes] = await Promise.all([
      fetch("/api/user/subscription/checkout/context", { cache: "no-store" }),
      fetch("/api/user/subscription/summary", { cache: "no-store" }),
    ]);
    const contextPayload = (await contextRes.json()) as CheckoutContextPayload;
    const summaryPayload = (await summaryRes.json()) as SubscriptionSummary;
    if (!contextRes.ok || !contextPayload.success) {
      throw new Error((contextPayload as any).error || "Failed to load add-ons context");
    }
    if (!summaryRes.ok || !summaryPayload.success) {
      throw new Error((summaryPayload as any).error || "Failed to load add-ons summary");
    }
    setContext(contextPayload);
    setSummary(summaryPayload);
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshPageState().catch((err: any) => {
      setError(err?.message || "Failed to load add-ons page");
      setLoading(false);
    });
  }, [refreshPageState]);

  const addOns = context?.add_ons || [];
  const capacityCatalog = useMemo(
    () => addOns.filter((addon) => addon.addon_kind === "structural" && addon.billing_mode === "recurring"),
    [addOns]
  );
  const codeCatalog = useMemo(
    () => addOns.filter((addon) => addon.addon_kind === "variable_quota" && addon.billing_mode === "one_time"),
    [addOns]
  );
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
  const selectedCapacityTotal = useMemo(
    () =>
      selectedCapacityItems.reduce((sum, item) => {
        const addon = capacityCatalog.find((entry) => entry.id === item.addon_id);
        return sum + Math.round((addon?.price_inr || 0) * 100 * item.quantity);
      }, 0),
    [capacityCatalog, selectedCapacityItems]
  );
  const selectedCodeTotal = useMemo(
    () =>
      selectedCodeItems.reduce((sum, item) => {
        const addon = codeCatalog.find((entry) => entry.id === item.addon_id);
        return sum + Math.round((addon?.price_inr || 0) * 100 * item.quantity);
      }, 0),
    [codeCatalog, selectedCodeItems]
  );
  const addonInvoices = summary?.addon_invoices || [];

  const createCheckout = useCallback(
    async (params: { capacityItems?: Array<{ addon_id: string; quantity: number }>; codeItems?: Array<{ addon_id: string; quantity: number }> }) => {
      if (!context?.current_subscription) {
        setError("An active subscription is required before buying add-ons.");
        return;
      }
      if (!(params.capacityItems?.length || params.codeItems?.length)) {
        setError("Select at least one add-on to continue.");
        return;
      }

      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch("/api/user/subscription/checkout/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            capacity_addons: params.capacityItems || [],
            code_addons: params.codeItems || [],
            addons: (params.codeItems || []).map((entry) => ({ addon_id: entry.addon_id, type: "codes", quantity: entry.quantity })),
          }),
        });
        const payload = (await res.json()) as QuoteApiResponse;
        if (!res.ok || !payload.success || !payload.quote_id) {
          throw new Error(payload.error || "Failed to prepare add-on checkout");
        }
        router.push(`/dashboard/checkout/${payload.quote_id}`);
      } catch (err: any) {
        setError(err?.message || "Failed to prepare add-on checkout");
      } finally {
        setSubmitting(false);
      }
    },
    [context?.current_subscription, router]
  );

  if (loading) return <p className="text-sm text-slate-500">Loading add-ons...</p>;
  if (!context) return <p className="text-sm text-rose-600">Unable to load add-ons context.</p>;

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-2 py-2">
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_35%),linear-gradient(135deg,#f8fafc_0%,#eff6ff_100%)] p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <Badge variant="outline" className="border-sky-200 bg-white/80 text-sky-700">
              One-time Purchases
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Buy capacity and code top-ups without subscription noise.</h1>
            <p className="text-sm leading-6 text-slate-600">
              This page is dedicated to add-ons only: timed capacity increases, code top-ups, current add-on balances, and
              add-on invoices. Plan selection and subscription lifecycle stay on the subscription page.
            </p>
          </div>
          <Button asChild variant="outline" className="bg-white">
            <Link href="/dashboard/subscription">Open Subscription</Link>
          </Button>
        </div>
      </section>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="rounded-[28px] border-slate-200">
          <CardHeader>
            <CardTitle>Active Capacity Add-ons</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {summary?.capacity_addons?.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {summary.capacity_addons.map((row) => (
                  <div key={`${row.addon_id}-${row.ends_at || ""}`} className="rounded-[24px] border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-950">{row.name || row.addon_id}</p>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{row.entitlement_key}</p>
                      </div>
                      <Badge variant="outline">+{row.quantity}</Badge>
                    </div>
                    <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
                      <p>Duration: {row.duration_days ? `${row.duration_days} days` : "-"}</p>
                      <p>Starts: {formatDateLabel(row.starts_at)}</p>
                      <p>Ends: {formatDateLabel(row.ends_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No active capacity add-ons.</p>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-slate-200">
          <CardHeader>
            <CardTitle>Code Top-up Balances</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {["unit", "box", "carton", "pallet"].map((metric) => (
              <div key={metric} className="rounded-[24px] border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">{metric}</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{summary?.add_on_balances?.[metric] ?? 0}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="rounded-[28px] border-slate-200">
          <CardHeader>
            <CardTitle>Capacity Add-ons</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {!context.current_subscription ? (
              <p className="text-sm text-slate-500">An active subscription is required before buying capacity add-ons.</p>
            ) : null}
            <div className="grid gap-4">
              {capacityCatalog.map((addon) => (
                <div key={addon.id} className="rounded-[24px] border border-slate-200 bg-white p-5">
                  <p className="text-lg font-semibold text-slate-950">{addon.name}</p>
                  <p className="text-sm text-slate-500">
                    {addon.entitlement_key} | {addon.duration_days || 30} days | INR {addon.price_inr}
                  </p>
                  {addon.description ? <p className="mt-2 text-sm leading-6 text-slate-600">{addon.description}</p> : null}
                  <div className="mt-4 space-y-1">
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
            <div className="flex flex-col gap-4 rounded-[24px] border border-slate-200 bg-slate-50/80 p-5 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold text-slate-950">Capacity selection</p>
                <p className="text-sm text-slate-500">
                  Estimated subtotal {formatINRFromPaise(selectedCapacityTotal)}. Coupons and taxes are applied on the checkout page.
                </p>
              </div>
              <Button onClick={() => createCheckout({ capacityItems: selectedCapacityItems })} disabled={submitting || selectedCapacityItems.length === 0}>
                Review Capacity Checkout
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-slate-200">
          <CardHeader>
            <CardTitle>Code Top-ups</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {!context.current_subscription ? (
              <p className="text-sm text-slate-500">An active subscription is required before buying code top-ups.</p>
            ) : null}
            <div className="grid gap-4">
              {codeCatalog.map((addon) => (
                <div key={addon.id} className="rounded-[24px] border border-slate-200 bg-white p-5">
                  <p className="text-lg font-semibold text-slate-950">{addon.name}</p>
                  <p className="text-sm text-slate-500">
                    {addon.entitlement_key} | 1 unit = {addon.pricing_unit_size.toLocaleString()} codes | INR {addon.price_inr}
                  </p>
                  {addon.description ? <p className="mt-2 text-sm leading-6 text-slate-600">{addon.description}</p> : null}
                  <div className="mt-4 space-y-1">
                    <LabelText text="Units to Purchase" />
                    <Input
                      type="number"
                      min={0}
                      value={codeQty[addon.id] ?? 0}
                      onChange={(e) => setCodeQty((prev) => ({ ...prev, [addon.id]: Math.max(0, Number(e.target.value) || 0) }))}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-4 rounded-[24px] border border-slate-200 bg-slate-50/80 p-5 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold text-slate-950">Code top-up selection</p>
                <p className="text-sm text-slate-500">
                  Estimated subtotal {formatINRFromPaise(selectedCodeTotal)}. Coupons and taxes are applied on the checkout page.
                </p>
              </div>
              <Button onClick={() => createCheckout({ codeItems: selectedCodeItems })} disabled={submitting || selectedCodeItems.length === 0}>
                Review Code Checkout
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-[28px] border-slate-200">
        <CardHeader>
          <CardTitle>Add-on Invoices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!addonInvoices.length ? (
            <p className="text-sm text-slate-500">No add-on invoices yet.</p>
          ) : (
            addonInvoices.map((invoice) => (
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
  );
}
