"use client";

import Link from "next/link";
import { ArrowRight, ReceiptText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSubscriptionSummary } from "@/lib/hooks/useSubscriptionSummary";

function formatInr(value: number | null | undefined) {
  return `INR ${Number(value || 0).toFixed(2)}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function BillingPage() {
  const { data, loading, error, refresh } = useSubscriptionSummary({ view: "full" });
  const invoices = data?.invoices || [];
  const subscriptionInvoices = data?.subscription_invoices || [];
  const addonInvoices = data?.addon_invoices || [];
  const subscription = data?.subscription;

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-6 py-10">
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.10),_transparent_35%),linear-gradient(135deg,#ffffff_0%,#f8fafc_100%)] p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <Badge variant="outline" className="border-slate-200 bg-white/80 text-slate-700">
              Billing Overview
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">A cleaner view of plans, purchases, and invoices.</h1>
            <p className="text-sm leading-6 text-slate-600">
              Subscription management and add-on purchases now have dedicated pages. This overview keeps the high-level billing
              picture together while linking out to the focused workflows.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => refresh({ force: true }).catch(() => undefined)} disabled={loading}>
              Refresh
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard/subscription">Subscription</Link>
            </Button>
            <Button asChild>
              <Link href="/dashboard/add-ons">Add-ons</Link>
            </Button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="rounded-[28px] border-slate-200">
          <CardHeader>
            <CardTitle>Current Subscription Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-600">
            {loading && !data ? (
              <div className="space-y-2">
                <div className="h-4 animate-pulse rounded bg-slate-100" />
                <div className="h-4 animate-pulse rounded bg-slate-100" />
                <div className="h-4 animate-pulse rounded bg-slate-100" />
              </div>
            ) : subscription ? (
              <>
                <div className="flex items-center justify-between rounded-[24px] border border-slate-200 bg-slate-50/80 p-5">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Plan</p>
                    <p className="mt-2 text-xl font-semibold text-slate-950">{subscription.plan_name || "Active subscription"}</p>
                    <p className="text-sm text-slate-500">
                      {subscription.billing_cycle || "-"} | {formatInr(subscription.plan_price_paise ? subscription.plan_price_paise / 100 : 0)}
                    </p>
                  </div>
                  <Badge variant="secondary">{subscription.status || "unknown"}</Badge>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-[24px] border border-slate-200 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Started</p>
                    <p className="mt-2 font-semibold text-slate-900">{formatDate(subscription.start_date || subscription.current_period_start)}</p>
                  </div>
                  <div className="rounded-[24px] border border-slate-200 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Renews</p>
                    <p className="mt-2 font-semibold text-slate-900">{formatDate(subscription.renewal_date || subscription.next_billing_at)}</p>
                  </div>
                  <div className="rounded-[24px] border border-slate-200 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Current Period Ends</p>
                    <p className="mt-2 font-semibold text-slate-900">{formatDate(subscription.current_period_end)}</p>
                  </div>
                </div>

                {subscription.cancel_at_period_end ? (
                  <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Cancellation is scheduled at period end. Access remains available until the current billing cycle closes.
                  </div>
                ) : null}
              </>
            ) : (
              <div className="rounded-[24px] border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
                No active subscription found. Start from the subscription page to purchase or renew a plan.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-slate-200">
          <CardHeader>
            <CardTitle>Invoice Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600">
            <div className="rounded-[24px] border border-slate-200 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">All invoices</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{invoices.length}</p>
            </div>
            <div className="rounded-[24px] border border-slate-200 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Subscription invoices</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{subscriptionInvoices.length}</p>
            </div>
            <div className="rounded-[24px] border border-slate-200 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Add-on invoices</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{addonInvoices.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-[28px] border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Subscription Billing</CardTitle>
            </div>
            <Button asChild variant="ghost" className="text-slate-600">
              <Link href="/dashboard/subscription">
                Open
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {!subscriptionInvoices.length ? (
              <p className="text-sm text-slate-500">No subscription invoices available yet.</p>
            ) : (
              subscriptionInvoices.slice(0, 4).map((invoice) => (
                <div key={invoice.id} className="flex items-center justify-between rounded-[24px] border border-slate-200 p-4">
                  <div>
                    <p className="font-semibold text-slate-950">{invoice.reference || "Invoice"}</p>
                    <p className="text-xs text-slate-500">
                      {invoice.invoice_label || invoice.invoice_type} | {invoice.status} | {formatDate(invoice.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="font-semibold text-slate-900">{formatInr(invoice.amount)}</p>
                    {invoice.invoice_pdf_url ? (
                      <Button asChild variant="outline" size="sm">
                        <Link href={invoice.invoice_pdf_url} target="_blank">
                          Download
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Add-on Billing</CardTitle>
            </div>
            <Button asChild variant="ghost" className="text-slate-600">
              <Link href="/dashboard/add-ons">
                Open
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {!addonInvoices.length ? (
              <p className="text-sm text-slate-500">No add-on invoices available yet.</p>
            ) : (
              addonInvoices.slice(0, 4).map((invoice) => (
                <div key={invoice.id} className="flex items-center justify-between rounded-[24px] border border-slate-200 p-4">
                  <div>
                    <p className="font-semibold text-slate-950">{invoice.reference || "Invoice"}</p>
                    <p className="text-xs text-slate-500">
                      {invoice.invoice_label || invoice.invoice_type} | {invoice.status} | {formatDate(invoice.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="font-semibold text-slate-900">{formatInr(invoice.amount)}</p>
                    {invoice.invoice_pdf_url ? (
                      <Button asChild variant="outline" size="sm">
                        <Link href={invoice.invoice_pdf_url} target="_blank">
                          Download
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-[28px] border-slate-200">
        <CardHeader>
          <CardTitle>Recent Billing Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && !data ? (
            <div className="space-y-2">
              <div className="h-4 animate-pulse rounded bg-slate-100" />
              <div className="h-4 animate-pulse rounded bg-slate-100" />
              <div className="h-4 animate-pulse rounded bg-slate-100" />
            </div>
          ) : !invoices.length ? (
            <p className="text-sm text-slate-500">No invoices available yet.</p>
          ) : (
            <div className="space-y-3">
              {invoices.slice(0, 8).map((invoice) => (
                <div key={invoice.id} className="flex flex-col gap-3 rounded-[24px] border border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-slate-100 p-2 text-slate-600">
                      <ReceiptText className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">{invoice.reference || "Invoice"}</p>
                      <p className="text-xs text-slate-500">
                        {invoice.invoice_label || invoice.invoice_type} | {invoice.status} | {formatDate(invoice.created_at)}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        Period: {formatDate(invoice.period_start)} to {formatDate(invoice.period_end)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="font-semibold text-slate-900">{formatInr(invoice.amount)}</p>
                      <p className="text-xs text-slate-500">{invoice.currency || "INR"}</p>
                    </div>
                    {invoice.invoice_pdf_url ? (
                      <Button asChild variant="outline">
                        <Link href={invoice.invoice_pdf_url} target="_blank">
                          Download PDF
                        </Link>
                      </Button>
                    ) : (
                      <Button variant="outline" disabled>
                        PDF Pending
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
