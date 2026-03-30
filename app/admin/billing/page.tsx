'use client';

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, ReceiptText, Wallet, Clock3 } from "lucide-react";

type BillingSummary = {
  total_invoices: number;
  paid_invoices: number;
  pending_invoices: number;
  total_amount: number;
};

type BillingInvoice = {
  id: string;
  company_id: string | null;
  invoice_type: string | null;
  status: string | null;
  reference: string | null;
  plan: string | null;
  amount: number | null;
  currency: string | null;
  provider_payment_id: string | null;
  issued_at: string | null;
  paid_at: string | null;
  created_at: string | null;
};

function formatInr(value: number | null | undefined) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatLabel(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase()) || "-";
}

export default function AdminBillingPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [summary, setSummary] = useState<BillingSummary>({
    total_invoices: 0,
    paid_invoices: 0,
    pending_invoices: 0,
    total_amount: 0,
  });
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);

  async function loadBilling() {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/billing", { cache: "no-store" });
      const out = await res.json().catch(() => ({}));

      if (!res.ok || !out?.success) {
        setError(out?.error?.message || out?.legacy_message || out?.error || "Failed to load billing data");
        setLoading(false);
        return;
      }

      setSummary(out.summary || {
        total_invoices: 0,
        paid_invoices: 0,
        pending_invoices: 0,
        total_amount: 0,
      });
      setInvoices(Array.isArray(out.invoices) ? out.invoices : []);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load billing data");
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBilling();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Billing</h1>
          <p className="text-sm text-slate-600">Latest invoice activity and billing status snapshot.</p>
        </div>
        <Button onClick={loadBilling} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error ? (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6 text-sm text-red-700">{error}</CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><ReceiptText className="h-4 w-4" /> Total Invoices</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{summary.total_invoices}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-4 w-4" /> Paid Invoices</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{summary.paid_invoices}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4" /> Pending Invoices</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{summary.pending_invoices}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {invoices.map((invoice) => (
              <div key={invoice.id} className="rounded-lg border p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-1">
                    <div className="font-semibold text-slate-900">{invoice.plan || "Subscription / Add-on"}</div>
                    <div className="text-sm text-slate-700">{invoice.reference || invoice.id}</div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Badge variant="outline">{formatLabel(invoice.invoice_type)}</Badge>
                      <Badge variant={String(invoice.status || "").toLowerCase() === "paid" ? "secondary" : "outline"}>
                        {formatLabel(invoice.status)}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold text-slate-900">{formatInr(invoice.amount)}</div>
                    <div className="text-xs text-slate-500">
                      {invoice.created_at ? new Date(invoice.created_at).toLocaleString() : "-"}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 text-xs text-slate-500 md:grid-cols-2">
                  <div>Company ID: {invoice.company_id || "-"}</div>
                  <div>Payment ID: {invoice.provider_payment_id || "-"}</div>
                </div>
              </div>
            ))}

            {invoices.length === 0 ? (
              <div className="py-10 text-center text-slate-500">No billing invoices found.</div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
