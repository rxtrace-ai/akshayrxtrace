"use client";

import Link from "next/link";
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
  const subscription = data?.subscription;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Billing</h1>
          <p className="mt-1 text-sm text-slate-500">
            Review your active subscription, renewal window, and invoice history without leaving the dashboard.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => refresh({ force: true }).catch(() => undefined)} disabled={loading}>
            Refresh
          </Button>
          <Button asChild>
            <Link href="/dashboard/subscription">Manage Subscription</Link>
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Current Billing State</CardTitle>
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
                <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Plan</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">{subscription.plan_name || "Active subscription"}</p>
                    <p className="text-xs text-slate-500">
                      {subscription.billing_cycle || "-"} | {formatInr(subscription.plan_price_paise ? subscription.plan_price_paise / 100 : 0)}
                    </p>
                  </div>
                  <Badge variant="secondary">{subscription.status || "unknown"}</Badge>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 p-4">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Started</p>
                    <p className="mt-1 font-semibold text-slate-900">{formatDate(subscription.start_date || subscription.current_period_start)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-4">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Renews</p>
                    <p className="mt-1 font-semibold text-slate-900">{formatDate(subscription.renewal_date || subscription.next_billing_at)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-4">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Current Period Ends</p>
                    <p className="mt-1 font-semibold text-slate-900">{formatDate(subscription.current_period_end)}</p>
                  </div>
                </div>

                {subscription.cancel_at_period_end ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Cancellation is scheduled at period end. Access remains available until the current billing cycle closes.
                  </div>
                ) : null}
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
                No active subscription found. Start from the subscription page to purchase or renew a plan.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoice Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600">
            <div className="rounded-lg border border-slate-200 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Invoices Available</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{invoices.length}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Latest Invoice</p>
              <p className="mt-1 font-semibold text-slate-900">{invoices[0]?.reference || "-"}</p>
              <p className="text-xs text-slate-500">{formatDate(invoices[0]?.created_at)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Latest Amount</p>
              <p className="mt-1 font-semibold text-slate-900">{formatInr(invoices[0]?.amount)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invoice History</CardTitle>
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
              {invoices.map((invoice) => (
                <div key={invoice.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-semibold text-slate-900">{invoice.reference || "Invoice"}</p>
                    <p className="text-xs text-slate-500">
                      {invoice.plan || invoice.invoice_type} | {invoice.status} | {formatDate(invoice.created_at)}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      Period: {formatDate(invoice.period_start)} to {formatDate(invoice.period_end)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="font-semibold text-slate-900">{formatInr(invoice.amount)}</p>
                      <p className="text-xs text-slate-500">{invoice.currency || "INR"}</p>
                    </div>
                    {invoice.invoice_pdf_url ? (
                      <Button asChild variant="outline">
                        <Link href={invoice.invoice_pdf_url} target="_blank">Download PDF</Link>
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
